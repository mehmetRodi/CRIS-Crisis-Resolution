import { Category, PriorityBand, ReportStatus, Urgency } from '@crisismap/shared';

import type { CoordinatorIncident } from '../coordinator/incidents';

/**
 * Shared fixtures for the workspace tests (CRIS-54).
 *
 * A `CoordinatorIncident` has fourteen public fields plus five staff-only ones,
 * so building one inline in every test buries the single field a test is
 * actually about. Overriding one property against a sane default keeps each
 * assertion legible.
 */
export function coordinatorIncident(
  overrides: Partial<CoordinatorIncident> = {},
): CoordinatorIncident {
  return {
    reportId: 'r1',
    status: ReportStatus.AI_CLASSIFIED,
    category: Category.FIRE,
    urgency: Urgency.HIGH,
    priorityScore: 7.2,
    priorityBand: PriorityBand.P1,
    summary: 'Stairwell fire, residents evacuating.',
    lat: 41.02,
    lng: 28.98,
    geohash: null,
    geohashPrefix: null,
    regionId: 'kadikoy',
    createdAt: '2026-08-31T10:00:00.000Z',
    updatedAt: '2026-08-31T10:05:00.000Z',
    version: 3,
    confidence: 0.86,
    scoreVersion: 2,
    scoreBreakdown: null,
    entities: null,
    assignedTeamId: null,
    ...overrides,
  };
}
