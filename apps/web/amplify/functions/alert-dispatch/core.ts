import {
  AlertChannel,
  AlertDeliveryStatus,
  matchesSubscription,
  type AlertCandidate,
} from '@crisismap/shared';
import type { AlertStore, AlertSubscriptionRecord } from './store';
import type { Deliverer } from './deliver';

/**
 * Per-candidate matching + delivery orchestration for the alert-dispatch
 * worker (design doc §2.7, §5, Fig 10; CRIS-34). Mirrors `classify-report`'s
 * `processRecord`/`dedupe.ts` split: this module is the testable core,
 * depending only on injected `AlertStore`/`Deliverer`/contact-lookup, so it's
 * exercised with fakes — no real AWS calls in tests.
 *
 * Channel scope: only SMS and EMAIL are delivered. PUSH stays a declarable
 * `AlertSubscription.channels` value, but the mobile device-token
 * registration infrastructure it needs doesn't exist yet — a matched PUSH
 * channel is logged and skipped, never attempted, never recorded as a
 * misleading `FAILED` delivery.
 */

export interface ContactInfo {
  email: string | null;
  phoneNumber: string | null;
}

export interface AlertDispatchDeps {
  store: AlertStore;
  deliver: Deliverer;
  /** Resolves a subscription's Cognito `userId` (sub) to contact info. */
  lookupContact: (userId: string) => Promise<ContactInfo | null>;
  log?: (entry: Record<string, unknown>) => void;
  /** Injected for deterministic `lastAttemptAt` timestamps in tests. */
  now?: () => Date;
}

const SUPPORTED_CHANNELS: readonly AlertChannel[] = [AlertChannel.SMS, AlertChannel.EMAIL];

function deliveryId(reportId: string, recipientId: string, channel: AlertChannel): string {
  return `${reportId}#${recipientId}#${channel}`;
}

/**
 * Attempts one channel for one matched subscription. Idempotent (skips if a
 * delivery record already exists) and self-contained: a failure here is
 * logged and recorded as `FAILED`, never thrown — one recipient's bad contact
 * info or a transient SNS/SES error must not stop the rest of the fan-out.
 */
async function dispatchChannel(
  deps: AlertDispatchDeps,
  candidate: AlertCandidate,
  subscription: AlertSubscriptionRecord,
  channel: AlertChannel,
  log: (entry: Record<string, unknown>) => void,
  nowIso: string,
): Promise<void> {
  const id = deliveryId(candidate.reportId, subscription.userId, channel);
  const created = await deps.store.putDeliveryIfAbsent({
    id,
    reportId: candidate.reportId,
    recipientId: subscription.userId,
    channel,
    status: AlertDeliveryStatus.PENDING,
    attempts: 0,
    lastAttemptAt: null,
    createdAt: nowIso,
  });
  if (!created) {
    log({ event: 'alert.delivery.skip.duplicate', id });
    return;
  }

  try {
    const contact = await deps.lookupContact(subscription.userId);
    if (channel === AlertChannel.SMS && contact?.phoneNumber) {
      await deps.deliver.deliverSms(
        contact.phoneNumber,
        `CrisisMap alert: a ${candidate.priorityBand} incident was reported near you.`,
      );
    } else if (channel === AlertChannel.EMAIL && contact?.email) {
      await deps.deliver.deliverEmail(
        contact.email,
        'CrisisMap AI proximity alert',
        `A ${candidate.priorityBand} incident (${candidate.category ?? 'uncategorized'}) was reported near your subscribed area.`,
      );
    } else {
      throw new Error(`no ${channel} contact info for user`);
    }
    await deps.store.updateDeliveryStatus({
      id,
      status: AlertDeliveryStatus.SENT,
      attempts: 1,
      lastAttemptAt: nowIso,
    });
    log({ event: 'alert.delivery.sent', id, channel });
  } catch (err) {
    await deps.store.updateDeliveryStatus({
      id,
      status: AlertDeliveryStatus.FAILED,
      attempts: 1,
      lastAttemptAt: nowIso,
    });
    log({
      event: 'alert.delivery.failed',
      id,
      channel,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Matches `candidate` against every active subscription in its region and
 * dispatches SMS/EMAIL for each match. Infra failures reading subscriptions
 * propagate (so SQS retries the whole message); per-recipient delivery
 * failures do not.
 */
export async function processCandidate(
  deps: AlertDispatchDeps,
  candidate: AlertCandidate,
): Promise<void> {
  const log = deps.log ?? ((entry) => console.log(JSON.stringify(entry)));
  const nowIso = (deps.now ?? (() => new Date()))().toISOString();

  // Two independent, non-exclusive candidate sets (CRIS-34): a subscription
  // may set a regionId, a geofence (centerGeohash/radiusMeters), or both — and
  // a report may carry a region, a resolved location, both, or neither.
  // Querying both and merging by id (rather than requiring one signal) means
  // a region-less geofence subscription still works, and vice versa.
  const [byRegion, byGeohash] = await Promise.all([
    candidate.regionId ? deps.store.queryActiveSubscriptions(candidate.regionId) : [],
    candidate.geohashPrefix
      ? deps.store.queryActiveSubscriptionsByGeohashPrefix(candidate.geohashPrefix)
      : [],
  ]);
  const subscriptions = [...new Map([...byRegion, ...byGeohash].map((s) => [s.id, s])).values()];

  if (subscriptions.length === 0) {
    log({ event: 'alert.skip.noCandidates', reportId: candidate.reportId });
    return;
  }

  let matched = 0;

  for (const subscription of subscriptions) {
    if (!matchesSubscription(subscription, candidate)) continue;
    matched += 1;

    const channels = (subscription.channels ?? []).filter((c): c is AlertChannel =>
      (SUPPORTED_CHANNELS as readonly string[]).includes(c),
    );
    const unsupported = (subscription.channels ?? []).filter(
      (c) => !(SUPPORTED_CHANNELS as readonly string[]).includes(c),
    );
    for (const c of unsupported) {
      log({ event: 'alert.channel.unsupported', channel: c, userId: subscription.userId });
    }

    for (const channel of channels) {
      await dispatchChannel(deps, candidate, subscription, channel, log, nowIso);
    }
  }

  log({
    event: 'alert.dispatch.done',
    reportId: candidate.reportId,
    subscriptions: subscriptions.length,
    matched,
  });
}
