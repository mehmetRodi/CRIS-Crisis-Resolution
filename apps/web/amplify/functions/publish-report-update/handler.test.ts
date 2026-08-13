import { describe, expect, it } from 'vitest';
import { PUBLIC_REPORT_FIELDS } from '@crisismap/shared';
import { appSyncEvent, invokeHandler } from '../testing/appsync';
import { handler } from './handler';

describe('publishReportUpdate handler integration', () => {
  it('returns only the public projection and normalizes omitted optional fields to null', async () => {
    const result = await invokeHandler(
      handler,
      appSyncEvent({
        reportId: 'report-1',
        status: 'AI_CLASSIFIED',
        summary: 'Road blocked by debris',
        lat: 41.01,
        lng: 28.97,
        reporterContact: 'must never cross the projection boundary',
      }),
    );

    expect(Object.keys(result).sort()).toEqual([...PUBLIC_REPORT_FIELDS].sort());
    expect(result).toMatchObject({
      reportId: 'report-1',
      status: 'AI_CLASSIFIED',
      summary: 'Road blocked by debris',
      lat: 41.01,
      lng: 28.97,
      category: null,
      urgency: null,
      priorityScore: null,
      priorityBand: null,
      updatedAt: null,
    });
    expect(result).not.toHaveProperty('reporterContact');
  });
});
