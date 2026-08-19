import { describe, expect, it, vi } from 'vitest';
import { AlertChannel, AlertDeliveryStatus, Category, PriorityBand, Urgency } from '@crisismap/shared';
import { processCandidate, type AlertDispatchDeps, type ContactInfo } from './core';
import type { AlertDeliveryRecord, AlertStore, AlertSubscriptionRecord } from './store';
import type { Deliverer } from './deliver';

function candidate(overrides: Partial<Parameters<typeof processCandidate>[1]> = {}) {
  return {
    reportId: 'report-1',
    category: Category.FIRE,
    urgency: Urgency.CRITICAL,
    priorityBand: PriorityBand.P0,
    regionId: 'region-a',
    lat: 41.0082,
    lng: 28.9784,
    geohashPrefix: 'sxk97',
    ...overrides,
  };
}

function subscription(overrides: Partial<AlertSubscriptionRecord> = {}): AlertSubscriptionRecord {
  return {
    id: 'sub-1',
    userId: 'user-1',
    categories: null,
    minUrgency: null,
    channels: [AlertChannel.SMS, AlertChannel.EMAIL],
    centerGeohash: null,
    radiusMeters: null,
    active: true,
    ...overrides,
  };
}

interface Fakes {
  deps: AlertDispatchDeps;
  deliveries: Map<string, AlertDeliveryRecord>;
  deliverSms: ReturnType<typeof vi.fn>;
  deliverEmail: ReturnType<typeof vi.fn>;
}

function fakeDeps(
  subscriptions: AlertSubscriptionRecord[],
  contacts: Record<string, ContactInfo | null> = {},
): Fakes {
  const deliveries = new Map<string, AlertDeliveryRecord>();

  const store: AlertStore = {
    async queryActiveSubscriptions() {
      return subscriptions;
    },
    async queryActiveSubscriptionsByGeohashPrefix() {
      return subscriptions;
    },
    async putDeliveryIfAbsent(delivery) {
      if (deliveries.has(delivery.id)) return false;
      deliveries.set(delivery.id, delivery);
      return true;
    },
    async updateDeliveryStatus(input) {
      const existing = deliveries.get(input.id);
      if (existing) {
        deliveries.set(input.id, {
          ...existing,
          status: input.status,
          attempts: input.attempts,
          lastAttemptAt: input.lastAttemptAt,
        });
      }
    },
  };

  const deliverSms = vi.fn().mockResolvedValue(undefined);
  const deliverEmail = vi.fn().mockResolvedValue(undefined);
  const deliver: Deliverer = { deliverSms, deliverEmail };

  const lookupContact = async (userId: string) =>
    userId in contacts ? contacts[userId]! : { email: 'user@example.com', phoneNumber: '+15551234567' };

  const deps: AlertDispatchDeps = {
    store,
    deliver,
    lookupContact,
    log: () => {},
    now: () => new Date('2026-08-17T00:00:00.000Z'),
  };

  return { deps, deliveries, deliverSms, deliverEmail };
}

describe('processCandidate', () => {
  it('does nothing when the candidate has neither a region nor a location', async () => {
    const { deps, deliveries } = fakeDeps([subscription()]);
    await processCandidate(deps, candidate({ regionId: null, geohashPrefix: null }));
    expect(deliveries.size).toBe(0);
  });

  it('still matches via geohash-prefix discovery when the candidate has no region', async () => {
    const { deps, deliveries } = fakeDeps([subscription()]);
    await processCandidate(deps, candidate({ regionId: null }));
    expect(deliveries.size).toBe(2); // SMS + EMAIL
  });

  it('still matches via region discovery when the candidate has no resolved location', async () => {
    const { deps, deliveries } = fakeDeps([subscription()]);
    await processCandidate(deps, candidate({ geohashPrefix: null, lat: null, lng: null }));
    expect(deliveries.size).toBe(2);
  });

  it('does not double-dispatch when the same subscription is found by both paths', async () => {
    const { deps, deliverSms } = fakeDeps([subscription()]); // fakeDeps returns the same set for both queries
    await processCandidate(deps, candidate());
    expect(deliverSms).toHaveBeenCalledTimes(1);
  });

  it('delivers SMS and EMAIL to a matching, active subscription', async () => {
    const { deps, deliveries, deliverSms, deliverEmail } = fakeDeps([subscription()]);
    await processCandidate(deps, candidate());

    expect(deliverSms).toHaveBeenCalledWith('+15551234567', expect.stringContaining('P0'));
    expect(deliverEmail).toHaveBeenCalledWith(
      'user@example.com',
      expect.any(String),
      expect.any(String),
    );
    expect(deliveries.size).toBe(2);
    for (const d of deliveries.values()) {
      expect(d.status).toBe(AlertDeliveryStatus.SENT);
    }
  });

  it('skips an inactive subscription', async () => {
    const { deps, deliveries } = fakeDeps([subscription({ active: false })]);
    await processCandidate(deps, candidate());
    expect(deliveries.size).toBe(0);
  });

  it('skips a subscription whose category filter excludes the candidate', async () => {
    const { deps, deliveries } = fakeDeps([subscription({ categories: [Category.FLOOD] })]);
    await processCandidate(deps, candidate({ category: Category.FIRE }));
    expect(deliveries.size).toBe(0);
  });

  it('logs and skips PUSH without attempting delivery or creating a delivery record', async () => {
    const log = vi.fn();
    const { deps, deliveries } = fakeDeps([subscription({ channels: [AlertChannel.PUSH] })]);
    await processCandidate({ ...deps, log }, candidate());
    expect(deliveries.size).toBe(0);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'alert.channel.unsupported', channel: 'PUSH' }),
    );
  });

  it('is idempotent: a second call for the same candidate does not re-dispatch', async () => {
    const { deps, deliverSms, deliverEmail } = fakeDeps([subscription()]);
    await processCandidate(deps, candidate());
    await processCandidate(deps, candidate());
    expect(deliverSms).toHaveBeenCalledTimes(1);
    expect(deliverEmail).toHaveBeenCalledTimes(1);
  });

  it('records FAILED and continues when delivery throws, without failing other recipients', async () => {
    const { deps, deliveries } = fakeDeps([subscription({ id: 'sub-1', userId: 'user-1' })]);
    (deps.deliver.deliverSms as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('SNS unavailable'),
    );
    await processCandidate(deps, candidate());

    const sms = deliveries.get('report-1#user-1#SMS');
    expect(sms?.status).toBe(AlertDeliveryStatus.FAILED);
    const email = deliveries.get('report-1#user-1#EMAIL');
    expect(email?.status).toBe(AlertDeliveryStatus.SENT);
  });

  it('records FAILED when the recipient has no contact info for the channel', async () => {
    const { deps, deliveries } = fakeDeps([subscription()], { 'user-1': { email: null, phoneNumber: null } });
    await processCandidate(deps, candidate());
    expect(deliveries.get('report-1#user-1#SMS')?.status).toBe(AlertDeliveryStatus.FAILED);
    expect(deliveries.get('report-1#user-1#EMAIL')?.status).toBe(AlertDeliveryStatus.FAILED);
  });
});
