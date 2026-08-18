import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportStatus, UserRole } from '@crisismap/shared';
import { appSyncEvent, cognitoIdentity, invokeHandler } from '../testing/appsync';
import { fakeDocumentClient, fakeDynamo } from '../testing/fake-dynamo';

const mocks = vi.hoisted(() => {
  process.env.REPORT_TABLE_NAME = 'Report-test';
  process.env.TEAM_TABLE_NAME = 'Team-test';
  process.env.ASSIGNMENT_TABLE_NAME = 'Assignment-test';
  process.env.REPORT_EVENT_TABLE_NAME = 'ReportEvent-test';
  return { publishAssignmentUpdate: vi.fn() };
});

vi.mock('@aws-sdk/lib-dynamodb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/lib-dynamodb')>();
  return {
    ...actual,
    DynamoDBDocumentClient: { from: () => fakeDocumentClient },
  };
});

vi.mock('./publish', () => ({
  publishAssignmentUpdate: mocks.publishAssignmentUpdate,
}));

import { handler } from './handler';

const report = {
  id: 'report-1',
  status: ReportStatus.VERIFIED,
  version: 4,
  createdAt: '2026-08-14T09:00:00.000Z',
};
const team = { id: 'team-1', name: 'Alpha Rescue', active: true };

function assignEvent() {
  return appSyncEvent(
    { reportId: 'report-1', teamId: 'team-1', expectedVersion: 4 },
    cognitoIdentity({ sub: 'actor-sub', groups: [UserRole.COORDINATOR] }),
  );
}

describe('assignTeam handler integration', () => {
  beforeEach(() => {
    fakeDynamo.reset();
    mocks.publishAssignmentUpdate.mockReset().mockResolvedValue(undefined);
  });

  it('commits one active assignment and publishes the updated report', async () => {
    fakeDynamo.queue('GetCommand', { Item: report });
    fakeDynamo.queue('GetCommand', { Item: team });

    const result = await invokeHandler(handler, assignEvent());

    expect(result).toMatchObject({ id: 'report-1', assignedTeamId: 'team-1', version: 5 });
    expect(fakeDynamo.sentOf('TransactWriteCommand')).toHaveLength(1);
    expect(mocks.publishAssignmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'report-1', assignedTeamId: 'team-1', version: 5 }),
    );
  });

  it('rejects reassignment before creating another active Assignment row', async () => {
    fakeDynamo.queue('GetCommand', { Item: { ...report, assignedTeamId: 'team-existing' } });
    fakeDynamo.queue('GetCommand', { Item: team });

    await expect(invokeHandler(handler, assignEvent())).rejects.toThrow(/^ILLEGAL:/);
    expect(fakeDynamo.sentOf('TransactWriteCommand')).toHaveLength(0);
    expect(mocks.publishAssignmentUpdate).not.toHaveBeenCalled();
  });
});
