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
/** Shorter than the queue's 180-second visibility timeout, so crashed attempts can resume. */
const DELIVERY_ATTEMPT_LEASE_MS = 120_000;

class MissingContactError extends Error {}

function deliveryId(reportId: string, recipientId: string, channel: AlertChannel): string {
  return `${reportId}#${recipientId}#${channel}`;
}

/** Stable Cognito identifier extracted from Amplify's default owner representation. */
export function recipientIdFromOwner(owner: string): string {
  const delimiter = owner.indexOf('::');
  return delimiter > 0 ? owner.slice(0, delimiter) : owner;
}

/**
 * Attempts one channel for one matched subscription. SENT deliveries are
 * skipped; failed or expired PENDING attempts are claimed again. The outcome
 * lets the caller finish the fan-out before asking SQS to retry transient
 * provider/infrastructure failures.
 */
async function dispatchChannel(
  deps: AlertDispatchDeps,
  candidate: AlertCandidate,
  subscription: AlertSubscriptionRecord,
  channel: AlertChannel,
  log: (entry: Record<string, unknown>) => void,
  nowIso: string,
  leaseExpiresBefore: string,
): Promise<'sent' | 'skipped' | 'permanent-failure' | 'retryable-failure'> {
  const recipientId = recipientIdFromOwner(subscription.userId);
  const id = deliveryId(candidate.reportId, recipientId, channel);
  const attempts = await deps.store.claimDeliveryAttempt({
    delivery: {
      id,
      reportId: candidate.reportId,
      recipientId,
      channel,
      status: AlertDeliveryStatus.PENDING,
      attempts: 0,
      lastAttemptAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    leaseExpiresBefore,
  });
  if (attempts == null) {
    log({ event: 'alert.delivery.skip.duplicate', reportId: candidate.reportId, channel });
    return 'skipped';
  }

  try {
    const contact = await deps.lookupContact(recipientId);
    if (channel === AlertChannel.SMS && contact?.phoneNumber) {
      await deps.deliver.deliverSms(
        contact.phoneNumber,
        `CRIS alert: a ${candidate.priorityBand} incident was reported near you.`,
      );
    } else if (channel === AlertChannel.EMAIL && contact?.email) {
      await deps.deliver.deliverEmail(
        contact.email,
        'CRIS proximity alert',
        `A ${candidate.priorityBand} incident (${candidate.category ?? 'uncategorized'}) was reported near your subscribed area.`,
      );
    } else {
      throw new MissingContactError(`no ${channel} contact info for user`);
    }
    await deps.store.updateDeliveryStatus({
      id,
      status: AlertDeliveryStatus.SENT,
      attempts,
      lastAttemptAt: nowIso,
    });
    log({ event: 'alert.delivery.sent', reportId: candidate.reportId, channel, attempts });
    return 'sent';
  } catch (err) {
    let statusRecorded = true;
    try {
      await deps.store.updateDeliveryStatus({
        id,
        status: AlertDeliveryStatus.FAILED,
        attempts,
        lastAttemptAt: nowIso,
      });
    } catch (statusErr) {
      statusRecorded = false;
      log({
        event: 'alert.delivery.statusUpdateFailed',
        reportId: candidate.reportId,
        channel,
        errorType: statusErr instanceof Error ? statusErr.name : typeof statusErr,
      });
    }
    log({
      event: 'alert.delivery.failed',
      reportId: candidate.reportId,
      channel,
      errorType: err instanceof Error ? err.name : typeof err,
    });
    return err instanceof MissingContactError && statusRecorded
      ? 'permanent-failure'
      : 'retryable-failure';
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
  const now = (deps.now ?? (() => new Date()))();
  const nowIso = now.toISOString();
  const leaseExpiresBefore = new Date(now.getTime() - DELIVERY_ATTEMPT_LEASE_MS).toISOString();

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
  let retryableFailures = 0;

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
      log({ event: 'alert.channel.unsupported', channel: c, reportId: candidate.reportId });
    }

    for (const channel of channels) {
      const outcome = await dispatchChannel(
        deps,
        candidate,
        subscription,
        channel,
        log,
        nowIso,
        leaseExpiresBefore,
      );
      if (outcome === 'retryable-failure') retryableFailures += 1;
    }
  }

  log({
    event: 'alert.dispatch.done',
    reportId: candidate.reportId,
    subscriptions: subscriptions.length,
    matched,
    retryableFailures,
  });

  if (retryableFailures > 0) {
    throw new Error(`${retryableFailures} alert delivery attempt(s) need retry`);
  }
}
