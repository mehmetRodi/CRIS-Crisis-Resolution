import { describe, expect, it, vi } from 'vitest';
import { QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ReportEventType } from '@crisismap/shared';
import {
  createDynamoStore,
  DUPLICATE_CANDIDATE_LIMIT,
  DUPLICATE_GROUP_MAX_MEMBERS,
} from './store';

/**
 * Persistence-layer contract for the duplicate-grouping writes (§5.4.3, CRIS-31).
 *
 * `dedupe.test.ts` mocks `ReportStore` wholesale, so nothing there exercises the
 * command shapes actually sent to DynamoDB — which is how a `ReportEvent` written
 * without its non-null `eventId` reached review. These tests own that boundary:
 * the *shape* of what is sent, not the maths (duplicate.test.ts) or the grouping
 * decisions (dedupe.test.ts).
 */

const TABLES = {
  report: 'Report-test',
  reportEvent: 'ReportEvent-test',
  geoIndex: 'reportsByGeohashPrefixAndGeohash',
};

/** A doc-client stand-in that records every command it is handed. */
function fakeClient(impl: (cmd: unknown) => unknown = () => ({})) {
  const sent: unknown[] = [];
  const send = vi.fn(async (cmd: unknown) => {
    sent.push(cmd);
    return impl(cmd);
  });
  return { client: { send } as unknown as DynamoDBDocumentClient, sent, send };
}

function transactionCancelled(): Error {
  const err = new Error('Transaction cancelled, please refer cancellation reasons');
  err.name = 'TransactionCanceledException';
  return err;
}

function member(reportId: string, expectedVersion: number) {
  return {
    reportId,
    expectedVersion,
    eventId: `evt-9#dup#${reportId}`,
    detail: { score: 0.91 },
  };
}

const LINK = { duplicateGroupId: 'g-1', members: [member('r-1', 4)] };

/** The TransactItems of the single transaction the store should have sent. */
function transactItems(sent: unknown[]) {
  const tx = sent.filter((c): c is TransactWriteCommand => c instanceof TransactWriteCommand);
  expect(tx).toHaveLength(1);
  return (tx[0]!.input.TransactItems ?? []) as Array<Record<string, any>>;
}

describe('linkDuplicateGroup', () => {
  it('writes the audit event with a non-null eventId', async () => {
    // Regression guard: `eventId` is `.required()` on ReportEvent, and a row
    // missing it makes AppSync fail non-null resolution for the *whole*
    // eventsByReport query — the entire coordinator timeline for that report,
    // not just this event.
    const { client, sent } = fakeClient();
    const store = createDynamoStore(TABLES, client);

    await store.linkDuplicateGroup(LINK);

    const put = transactItems(sent).find((i) => i.Put)!.Put;
    expect(put.TableName).toBe('ReportEvent-test');
    expect(put.Item).toMatchObject({
      reportId: 'r-1',
      type: ReportEventType.DUPLICATE_LINKED,
      eventId: 'evt-9#dup#r-1',
      version: 5,
    });
    expect(put.Item.eventId).toBeTruthy();
  });

  it('carries the caller detail alongside the group id', async () => {
    const { client, sent } = fakeClient();
    const store = createDynamoStore(TABLES, client);

    await store.linkDuplicateGroup(LINK);

    const put = transactItems(sent).find((i) => i.Put)!.Put;
    expect(put.Item.detail).toEqual({ duplicateGroupId: 'g-1', score: 0.91 });
  });

  it('version-checks each update and returns true on success', async () => {
    const { client, sent } = fakeClient();
    const store = createDynamoStore(TABLES, client);

    await expect(store.linkDuplicateGroup(LINK)).resolves.toBe(true);

    const update = transactItems(sent).find((i) => i.Update)!.Update;
    expect(update.TableName).toBe('Report-test');
    expect(update.ConditionExpression).toBe('#v = :expected');
    expect(update.ExpressionAttributeValues).toMatchObject({
      ':expected': 4,
      ':next': 5,
      ':group': 'g-1',
    });
  });

  it('links every member in ONE transaction, update and audit together', async () => {
    // The atomicity guarantee: two independent conditional writes could each
    // succeed on the other's peer and fail on their own, cross-linking two
    // reports into singleton groups permanently.
    const { client, sent, send } = fakeClient();
    const store = createDynamoStore(TABLES, client);

    await store.linkDuplicateGroup({
      duplicateGroupId: 'g-1',
      members: [member('r-1', 4), member('r-2', 7), member('r-3', 2)],
    });

    expect(send).toHaveBeenCalledTimes(1);
    const items = transactItems(sent);
    expect(items).toHaveLength(6); // 3 members x (update + audit)
    expect(items.filter((i) => i.Update).map((i) => i.Update.Key.id)).toEqual([
      'r-1',
      'r-2',
      'r-3',
    ]);
    // Each member's own expected version, not a shared one.
    expect(items.filter((i) => i.Update).map((i) => i.Update.ExpressionAttributeValues[':expected']))
      .toEqual([4, 7, 2]);
  });

  it('returns false when the transaction is cancelled, having written nothing', async () => {
    // This is the `false` that dedupe.test.ts's race tests mock — nothing
    // previously verified the store ever produces it.
    const { client } = fakeClient(() => {
      throw transactionCancelled();
    });
    const store = createDynamoStore(TABLES, client);

    await expect(store.linkDuplicateGroup(LINK)).resolves.toBe(false);
  });

  it('rethrows errors that are not transaction cancellations', async () => {
    const { client } = fakeClient(() => {
      throw new Error('ProvisionedThroughputExceeded');
    });
    const store = createDynamoStore(TABLES, client);

    await expect(store.linkDuplicateGroup(LINK)).rejects.toThrow('ProvisionedThroughputExceeded');
  });

  it('refuses to write when asked for more members than a transaction holds', async () => {
    // Silently dropping members would produce a group that claims to hold
    // reports it never linked.
    const { client, send } = fakeClient();
    const store = createDynamoStore(TABLES, client);
    const tooMany = Array.from({ length: DUPLICATE_GROUP_MAX_MEMBERS + 1 }, (_, i) =>
      member(`r-${i}`, 1),
    );

    await expect(
      store.linkDuplicateGroup({ duplicateGroupId: 'g-1', members: tooMany }),
    ).rejects.toThrow(RangeError);
    expect(send).not.toHaveBeenCalled();
  });

  it('writes nothing for an empty member list', async () => {
    const { client, send } = fakeClient();
    const store = createDynamoStore(TABLES, client);

    await expect(
      store.linkDuplicateGroup({ duplicateGroupId: 'g-1', members: [] }),
    ).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('findDuplicateCandidates', () => {
  const QUERY = { geohashPrefix: 'u2edk', excludeReportId: 'r-self', since: '2026-07-31T11:00:00.000Z' };

  it('queries the injected geo index, not a guessed name', async () => {
    // The physical GSI name is derived in backend.ts from the Amplify
    // transformer's naming rule; a wrong value here degrades silently to
    // "dedup links nothing", so pin that it is passed through verbatim.
    const { client, sent } = fakeClient(() => ({ Items: [] }));
    const store = createDynamoStore(TABLES, client);

    await store.findDuplicateCandidates(QUERY);

    const query = sent.find((c): c is QueryCommand => c instanceof QueryCommand)!;
    expect(query.input.IndexName).toBe('reportsByGeohashPrefixAndGeohash');
    expect(query.input.TableName).toBe('Report-test');
    expect(query.input.KeyConditionExpression).toBe('geohashPrefix = :prefix');
    expect(query.input.Limit).toBe(DUPLICATE_CANDIDATE_LIMIT);
  });

  it('bounds the read by the recency window and excludes the subject', async () => {
    const { client, sent } = fakeClient(() => ({ Items: [] }));
    const store = createDynamoStore(TABLES, client);

    await store.findDuplicateCandidates(QUERY);

    const query = sent.find((c): c is QueryCommand => c instanceof QueryCommand)!;
    expect(query.input.ExpressionAttributeValues).toMatchObject({
      ':prefix': 'u2edk',
      ':since': '2026-07-31T11:00:00.000Z',
      ':self': 'r-self',
    });
  });

  it('maps missing optional attributes to conservative defaults', async () => {
    // A malformed row must score *away* from duplicate: '' category gates out,
    // '' createdAt parses to NaN so the time term is 0.
    const { client } = fakeClient(() => ({ Items: [{ id: 'r-2' }] }));
    const store = createDynamoStore(TABLES, client);

    await expect(store.findDuplicateCandidates(QUERY)).resolves.toEqual([
      {
        reportId: 'r-2',
        category: '',
        lat: null,
        lng: null,
        createdAt: '',
        text: null,
        entities: null,
        duplicateGroupId: null,
        version: 0,
      },
    ]);
  });

  it('returns an empty list when the query yields no Items', async () => {
    const { client } = fakeClient(() => ({}));
    const store = createDynamoStore(TABLES, client);

    await expect(store.findDuplicateCandidates(QUERY)).resolves.toEqual([]);
  });
});
