import type { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole, WorkAction, type ReportWorkView } from '@crisismap/shared';
import { appSyncEvent, cognitoIdentity } from '../testing/appsync';
import { fakeDocumentClient, fakeDynamo } from '../testing/fake-dynamo';
const mocks = vi.hoisted(() => {
  process.env.REPORT_TABLE_NAME = 'Report-test';
  process.env.REPORT_WORK_TABLE_NAME = 'Work-test';
  process.env.REPORT_EVENT_TABLE_NAME = 'Event-test';
  process.env.USER_POOL_ID = 'pool-test';
  return { publish: vi.fn(), cognito: vi.fn() };
});
vi.mock('@aws-sdk/lib-dynamodb', async (original) => ({
  ...(await original<typeof import('@aws-sdk/lib-dynamodb')>()),
  DynamoDBDocumentClient: { from: () => fakeDocumentClient },
}));
vi.mock('@aws-sdk/client-cognito-identity-provider', async (original) => ({
  ...(await original<typeof import('@aws-sdk/client-cognito-identity-provider')>()),
  CognitoIdentityProviderClient: class {
    send = mocks.cognito;
  },
}));
vi.mock('../assign-team/publish', () => ({ publishAssignmentUpdate: mocks.publish }));
import { handler } from './handler';
function event(
  fieldName = 'updateReportWork',
  action: string = WorkAction.CLAIM,
  role: UserRole = UserRole.VOLUNTEER,
) {
  const result = appSyncEvent(
    { reportId: 'r1', expectedVersion: 0, action, targetUsername: 'responder@example.test' },
    cognitoIdentity({ sub: 'actor', groups: [role] }),
  );
  result.info.fieldName = fieldName;
  return result;
}
const report = { id: 'r1', status: 'VERIFIED', version: 4 };
function queueReads(work?: Record<string, unknown>) {
  fakeDynamo.queue('GetCommand', { Item: report });
  fakeDynamo.queue('GetCommand', { Item: work });
}
describe('Work resolver integration', () => {
  beforeEach(() => {
    fakeDynamo.reset();
    vi.clearAllMocks();
  });
  it('writes ownership, report version, and audit in one conditional transaction', async () => {
    queueReads();
    fakeDynamo.queue('TransactWriteCommand', {});
    fakeDynamo.queue('GetCommand', { Item: report });
    const result = (await handler(event())) as ReportWorkView;
    expect(result.isMine).toBe(true);
    const transaction = fakeDynamo.sentOf('TransactWriteCommand')[0]!
      .input as TransactWriteCommandInput;
    expect(transaction.TransactItems).toHaveLength(3);
    expect(transaction.TransactItems?.[0]?.Update).toMatchObject({
      TableName: 'Report-test',
      ConditionExpression: '#version = :expected AND #status = :status',
      ExpressionAttributeValues: expect.objectContaining({ ':expected': 4, ':next': 5 }),
    });
    expect(transaction.TransactItems?.[1]?.Put).toMatchObject({
      TableName: 'Work-test',
      ConditionExpression: 'attribute_not_exists(id)',
      Item: expect.objectContaining({
        id: 'r1',
        assigneeId: 'actor',
        version: 1,
        updatesJson: '[]',
        updatedAt: expect.any(String),
      }),
    });
    expect(transaction.TransactItems?.[2]?.Put?.Item).toMatchObject({
      type: 'WORK_UPDATED',
      actorId: 'actor',
      updatedAt: expect.any(String),
    });
    expect(mocks.publish).toHaveBeenCalledOnce();
  });
  it('reports a lost transaction race as a conflict without publishing success', async () => {
    queueReads();
    const failure = new Error('Concurrent write');
    failure.name = 'TransactionCanceledException';
    fakeDynamo.failNext('TransactWriteCommand', failure);
    await expect(handler(event())).rejects.toThrow('CONFLICT');
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it('redacts notes and assignee identity from another volunteer', async () => {
    queueReads({
      id: 'r1',
      version: 2,
      assigneeId: 'someone-else',
      assigneeLabel: 'Responder',
      updatesJson: JSON.stringify([
        {
          id: 'note',
          text: 'Private operational detail',
          authorLabel: 'Responder',
          createdAt: '2026-09-05T00:00:00Z',
        },
      ]),
    });
    const result = (await handler(event('getReportWork'))) as ReportWorkView;
    expect(result).toMatchObject({ updates: [], isMine: false, canEdit: false });
    expect(result).not.toHaveProperty('assigneeId');
  });
  it('rejects citizens before any data read', async () => {
    await expect(
      handler(event('getReportWork', WorkAction.CLAIM, UserRole.CITIZEN)),
    ).rejects.toThrow('FORBIDDEN');
    expect(fakeDynamo.sentOf('GetCommand')).toHaveLength(0);
  });
  it('does not allow volunteers to look up or assign another person', async () => {
    queueReads();
    await expect(handler(event('updateReportWork', WorkAction.ASSIGN))).rejects.toThrow(
      'FORBIDDEN',
    );
    expect(mocks.cognito).not.toHaveBeenCalled();
    expect(fakeDynamo.sentOf('TransactWriteCommand')).toHaveLength(0);
  });
  it('validates the target account and group before coordinator assignment', async () => {
    queueReads();
    mocks.cognito
      .mockResolvedValueOnce({
        Username: 'target',
        Enabled: true,
        UserAttributes: [{ Name: 'sub', Value: 'target-sub' }],
      })
      .mockResolvedValueOnce({ Groups: [{ GroupName: UserRole.RESPONDER }] });
    fakeDynamo.queue('TransactWriteCommand', {});
    fakeDynamo.queue('GetCommand', { Item: report });
    const result = (await handler(
      event('updateReportWork', WorkAction.ASSIGN, UserRole.ADMIN),
    )) as ReportWorkView;
    expect(result.assigneeLabel).toBe('Team member target-s');
    expect(result.isMine).toBe(false);
    expect(mocks.cognito).toHaveBeenCalledTimes(2);
  });
  it('does not turn a missing report into a claimable task', async () => {
    fakeDynamo.queue('GetCommand', {});
    fakeDynamo.queue('GetCommand', {});
    await expect(handler(event())).rejects.toThrow('NOT_FOUND');
    expect(fakeDynamo.sentOf('TransactWriteCommand')).toHaveLength(0);
  });
  it('filters My tasks by authenticated identity in the server read', async () => {
    fakeDynamo.queue('ScanCommand', { Items: [{ id: 'r1' }] });
    expect(await handler(event('listMyReportWork'))).toEqual(['r1']);
    expect(fakeDynamo.sentOf('ScanCommand')[0]!.input).toMatchObject({
      ProjectionExpression: 'id',
      FilterExpression: 'assigneeId = :actor',
      ExpressionAttributeValues: { ':actor': 'actor' },
    });
  });
});
