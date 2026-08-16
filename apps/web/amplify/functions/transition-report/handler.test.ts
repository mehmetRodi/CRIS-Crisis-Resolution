import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportStatus, UserRole } from '@crisismap/shared';
import { appSyncEvent, cognitoIdentity, invokeHandler } from '../testing/appsync';
import { fakeDocumentClient, fakeDynamo, namedError } from '../testing/fake-dynamo';

const mocks = vi.hoisted(() => {
  process.env.REPORT_TABLE_NAME = 'Report-test';
  process.env.REPORT_EVENT_TABLE_NAME = 'ReportEvent-test';
  return { publishTransitionUpdate: vi.fn() };
});

vi.mock('@aws-sdk/lib-dynamodb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/lib-dynamodb')>();
  return {
    ...actual,
    DynamoDBDocumentClient: { from: () => fakeDocumentClient },
  };
});

vi.mock('./publish', () => ({
  publishTransitionUpdate: mocks.publishTransitionUpdate,
}));

import { handler } from './handler';

const report = {
  id: 'report-1',
  text: 'Internal report text',
  status: ReportStatus.AI_CLASSIFIED,
  version: 4,
  createdAt: '2026-08-14T09:00:00.000Z',
};

function transitionEvent(
  overrides: Partial<{ reportId: string; toStatus: ReportStatus; expectedVersion: number }> = {},
  groups: string[] | null = [UserRole.COORDINATOR],
) {
  return appSyncEvent(
    {
      reportId: 'report-1',
      toStatus: ReportStatus.VERIFIED,
      expectedVersion: 4,
      note: '  confirmed by field team  ',
      ...overrides,
    },
    cognitoIdentity({ sub: 'actor-sub', groups }),
  );
}

describe('updateReportStatus handler integration', () => {
  beforeEach(() => {
    fakeDynamo.reset();
    mocks.publishTransitionUpdate.mockReset();
  });

  it('resolves the highest caller role and atomically updates the report with an audit event', async () => {
    fakeDynamo.queue('GetCommand', { Item: report });

    const result = await invokeHandler(
      handler,
      transitionEvent({}, [UserRole.RESPONDER, UserRole.COORDINATOR]),
    );

    expect(result).toMatchObject({
      id: 'report-1',
      status: ReportStatus.VERIFIED,
      version: 5,
    });
    expect(result.updatedAt).toEqual(expect.any(String));

    const [transaction] = fakeDynamo.sentOf('TransactWriteCommand');
    const items = transaction?.input.TransactItems as [
      { Update: Record<string, unknown> },
      { Put: { TableName: string; Item: Record<string, unknown>; ConditionExpression: string } },
    ];
    expect(items[0].Update).toMatchObject({
      TableName: 'Report-test',
      Key: { id: 'report-1' },
      UpdateExpression: 'SET #status = :to, #version = :next, #updatedAt = :now',
      ConditionExpression: '#version = :expected',
      ExpressionAttributeValues: {
        ':to': ReportStatus.VERIFIED,
        ':next': 5,
        ':expected': 4,
      },
    });
    expect(items[1].Put).toMatchObject({
      TableName: 'ReportEvent-test',
      ConditionExpression: 'attribute_not_exists(id)',
      Item: {
        reportId: 'report-1',
        actorId: 'actor-sub',
        actorRole: UserRole.COORDINATOR,
        fromStatus: ReportStatus.AI_CLASSIFIED,
        toStatus: ReportStatus.VERIFIED,
        version: 5,
        detail: { note: 'confirmed by field team' },
      },
    });
    expect(mocks.publishTransitionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'report-1',
        status: ReportStatus.VERIFIED,
        version: 5,
      }),
    );
  });

  it('rejects callers without a transition role before reading DynamoDB', async () => {
    await expect(invokeHandler(handler, transitionEvent({}, null))).rejects.toThrow(/^FORBIDDEN:/);
    expect(fakeDynamo.sent).toHaveLength(0);
  });

  it('returns the stable NOT_FOUND prefix for a missing report', async () => {
    fakeDynamo.queue('GetCommand', {});
    await expect(invokeHandler(handler, transitionEvent())).rejects.toThrow(/^NOT_FOUND:/);
  });

  it('returns the stable ILLEGAL_TRANSITION prefix for a structurally invalid move', async () => {
    fakeDynamo.queue('GetCommand', { Item: report });
    await expect(
      invokeHandler(handler, transitionEvent({ toStatus: ReportStatus.RESOLVED })),
    ).rejects.toThrow(/^ILLEGAL_TRANSITION:/);
  });

  it('returns the stable FORBIDDEN prefix for a role-disallowed move', async () => {
    fakeDynamo.queue('GetCommand', {
      Item: { ...report, status: ReportStatus.RESOLVED },
    });
    await expect(
      invokeHandler(
        handler,
        transitionEvent({ toStatus: ReportStatus.IN_PROGRESS }, [UserRole.RESPONDER]),
      ),
    ).rejects.toThrow(/^FORBIDDEN:/);
  });

  it('returns the stable CONFLICT prefix when the read version is stale', async () => {
    fakeDynamo.queue('GetCommand', { Item: report });
    await expect(invokeHandler(handler, transitionEvent({ expectedVersion: 3 }))).rejects.toThrow(
      /^CONFLICT:/,
    );
  });

  it.each(['TransactionCanceledException', 'ConditionalCheckFailedException'])(
    'maps a DynamoDB %s to the stable CONFLICT prefix',
    async (errorName) => {
      fakeDynamo.queue('GetCommand', { Item: report });
      fakeDynamo.failNext('TransactWriteCommand', namedError(errorName));
      await expect(invokeHandler(handler, transitionEvent())).rejects.toThrow(/^CONFLICT:/);
    },
  );
});
