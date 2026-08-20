import { describe, expect, it, vi } from 'vitest';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { AlertChannel, AlertDeliveryStatus, PriorityBand } from '@crisismap/shared';
import { createDynamoAlertStore, type AlertDeliveryRecord } from './store';

const TABLES = {
  report: 'ReportTable',
  alertSubscription: 'SubscriptionTable',
  alertDelivery: 'DeliveryTable',
  regionIndex: 'subscriptionsByRegion',
  geohashPrefixIndex: 'subscriptionsByGeohash',
};

function fakeClient(...responses: Record<string, unknown>[]) {
  const send = vi.fn();
  for (const response of responses) send.mockResolvedValueOnce(response);
  return {
    send,
    client: { send } as unknown as DynamoDBDocumentClient,
  };
}

function delivery(): AlertDeliveryRecord {
  return {
    id: 'report-1#user-1#SMS',
    reportId: 'report-1',
    recipientId: 'user-1',
    channel: AlertChannel.SMS,
    status: AlertDeliveryStatus.PENDING,
    attempts: 0,
    lastAttemptAt: '2026-08-20T12:00:00.000Z',
    createdAt: '2026-08-20T12:00:00.000Z',
    updatedAt: '2026-08-20T12:00:00.000Z',
  };
}

describe('createDynamoAlertStore', () => {
  it('reads only PII-free report fields for the candidate', async () => {
    const { client, send } = fakeClient({
      Item: {
        id: 'report-1',
        category: 'FIRE',
        urgency: 'HIGH',
        regionId: 'region-1',
        lat: 41,
        lng: 29,
        geohashPrefix: 'sxk97',
      },
    });
    const store = createDynamoAlertStore(TABLES, client);

    await expect(store.getAlertCandidate('report-1', PriorityBand.P1)).resolves.toMatchObject({
      reportId: 'report-1',
      priorityBand: PriorityBand.P1,
      regionId: 'region-1',
    });
    expect(send.mock.calls[0]![0].input.ProjectionExpression).not.toContain('text');
    expect(send.mock.calls[0]![0].input.ProjectionExpression).not.toContain('reporter');
  });

  it('claims attempts atomically and sets both model timestamps', async () => {
    const { client, send } = fakeClient({ Attributes: { attempts: 2 } });
    const store = createDynamoAlertStore(TABLES, client);

    await expect(
      store.claimDeliveryAttempt({
        delivery: delivery(),
        leaseExpiresBefore: '2026-08-20T11:58:00.000Z',
      }),
    ).resolves.toBe(2);

    const input = send.mock.calls[0]![0].input;
    expect(input.UpdateExpression).toContain('#createdAt = if_not_exists(#createdAt, :now)');
    expect(input.UpdateExpression).toContain('#updatedAt = :now');
    expect(input.ConditionExpression).toContain('#s = :failed');
  });

  it('updates updatedAt with every delivery status change', async () => {
    const { client, send } = fakeClient({});
    const store = createDynamoAlertStore(TABLES, client);

    await store.updateDeliveryStatus({
      id: delivery().id,
      status: AlertDeliveryStatus.SENT,
      attempts: 1,
      lastAttemptAt: '2026-08-20T12:00:00.000Z',
    });

    expect(send.mock.calls[0]![0].input.UpdateExpression).toContain('updatedAt = :now');
  });

  it('reads every subscription query page', async () => {
    const { client, send } = fakeClient(
      { Items: [{ id: 'sub-1', userId: 'user-1' }], LastEvaluatedKey: { id: 'sub-1' } },
      { Items: [{ id: 'sub-2', userId: 'user-2' }] },
    );
    const store = createDynamoAlertStore(TABLES, client);

    await expect(store.queryActiveSubscriptions('region-1')).resolves.toHaveLength(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0].input.ExclusiveStartKey).toEqual({ id: 'sub-1' });
  });
});
