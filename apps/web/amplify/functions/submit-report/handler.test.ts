import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportStatus } from '@crisismap/shared';
import { appSyncEvent, cognitoIdentity, invokeHandler } from '../testing/appsync';
import { fakeDocumentClient, fakeDynamo, namedError } from '../testing/fake-dynamo';

vi.hoisted(() => {
  process.env.REPORT_TABLE_NAME = 'Report-test';
  process.env.REPORT_EVENT_TABLE_NAME = 'ReportEvent-test';
  process.env.IDEMPOTENCY_TABLE_NAME = 'IdempotencyRecord-test';
});

vi.mock('@aws-sdk/lib-dynamodb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/lib-dynamodb')>();
  return {
    ...actual,
    DynamoDBDocumentClient: { from: () => fakeDocumentClient },
  };
});

import { handler } from './handler';

const validArgs = {
  text: '  Flood water is entering the clinic.  ',
  clientRequestId: 'request-1',
  lat: 41.01,
  lng: 28.97,
  regionId: null,
  reporterContact: '+90 555 000 0000',
};

describe('submitReport handler integration', () => {
  beforeEach(() => fakeDynamo.reset());

  it('derives reporter identity and writes the guard, report, and event atomically', async () => {
    const result = await invokeHandler(
      handler,
      appSyncEvent(validArgs, cognitoIdentity({ sub: 'citizen-sub' })),
    );

    expect(result).toMatchObject({
      text: 'Flood water is entering the clinic.',
      status: ReportStatus.NEW,
      version: 1,
      reporterId: 'citizen-sub',
      isAnonymous: false,
      regionId: null,
    });
    expect(result.createdAt).toBe(result.updatedAt);

    const [transaction] = fakeDynamo.sentOf('TransactWriteCommand');
    expect(transaction?.input.ClientRequestToken).toBe('request-1');
    const transactItems = transaction?.input.TransactItems as Array<{
      Put: { TableName: string; Item: Record<string, unknown>; ConditionExpression: string };
    }>;
    expect(transactItems).toHaveLength(3);
    expect(transactItems.map(({ Put }) => Put.TableName)).toEqual([
      'IdempotencyRecord-test',
      'Report-test',
      'ReportEvent-test',
    ]);
    expect(transactItems.map(({ Put }) => Put.ConditionExpression)).toEqual([
      'attribute_not_exists(idempotencyKey)',
      'attribute_not_exists(id)',
      'attribute_not_exists(id)',
    ]);
    expect(transactItems[1]?.Put.Item).toMatchObject({
      reporterId: 'citizen-sub',
      updatedAt: result.updatedAt,
    });
    expect(transactItems[1]?.Put.Item).not.toHaveProperty('regionId');
    expect(transactItems[2]?.Put.Item).toMatchObject({
      reportId: result.id,
      actorId: 'citizen-sub',
      updatedAt: result.updatedAt,
    });
  });

  it('never persists identity or contact for an anonymous submission', async () => {
    const result = await invokeHandler(
      handler,
      appSyncEvent(
        { ...validArgs, isAnonymous: true },
        cognitoIdentity({ sub: 'ignored-citizen-sub' }),
      ),
    );

    expect(result).toMatchObject({ reporterId: null, reporterContact: null, isAnonymous: true });
    const [transaction] = fakeDynamo.sentOf('TransactWriteCommand');
    const items = transaction?.input.TransactItems as Array<{
      Put: { Item: Record<string, unknown> };
    }>;
    expect(items[1]?.Put.Item).not.toHaveProperty('reporterId');
    expect(items[1]?.Put.Item).not.toHaveProperty('reporterContact');
  });

  it.each(['TransactionCanceledException', 'IdempotentParameterMismatchException'])(
    'returns the original report when DynamoDB signals %s',
    async (errorName) => {
      const existing = {
        id: 'original-report',
        text: 'Original report',
        status: ReportStatus.NEW,
        version: 1,
      };
      fakeDynamo.failNext('TransactWriteCommand', namedError(errorName));
      fakeDynamo.queue('GetCommand', { Item: { reportId: existing.id } });
      fakeDynamo.queue('GetCommand', { Item: existing });

      await expect(invokeHandler(handler, appSyncEvent(validArgs))).resolves.toEqual(existing);
      expect(fakeDynamo.sentOf('GetCommand').map(({ input }) => input)).toEqual([
        { TableName: 'IdempotencyRecord-test', Key: { id: 'request-1' } },
        { TableName: 'Report-test', Key: { id: 'original-report' } },
      ]);
    },
  );

  it('rethrows a replay signal when its idempotency record cannot be resolved', async () => {
    const error = namedError('TransactionCanceledException');
    fakeDynamo.failNext('TransactWriteCommand', error);
    fakeDynamo.queue('GetCommand', {});

    await expect(invokeHandler(handler, appSyncEvent(validArgs))).rejects.toBe(error);
  });

  it('replaces an oversized request id with a DynamoDB-safe transaction token', async () => {
    const clientRequestId = 'r'.repeat(80);

    await invokeHandler(handler, appSyncEvent({ ...validArgs, clientRequestId }));

    const [transaction] = fakeDynamo.sentOf('TransactWriteCommand');
    expect(transaction?.input.ClientRequestToken).not.toBe(clientRequestId);
    expect(transaction?.input.ClientRequestToken).toMatch(/^[0-9a-f-]{36}$/);
  });
});
