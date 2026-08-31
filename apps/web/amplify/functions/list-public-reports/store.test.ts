import { describe, expect, it, vi } from 'vitest';
import { ReportStatus } from '@crisismap/shared';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { PROJECTION_EXPRESSION, PUBLIC_REPORT_READ_LIMIT, createPublicReportReader } from './store';

/**
 * The unauthenticated public-map read (CRIS-54, ADR-0056).
 *
 * This is the only data path in the product a caller with no credentials can
 * reach, so the tests below are about what must NEVER come back, not about
 * convenience. Each covers one of the three independent redaction layers.
 */

/** A raw DynamoDB item, deliberately including the columns that must not leak. */
function rawItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    status: ReportStatus.VERIFIED,
    category: 'FIRE',
    urgency: 'HIGH',
    priorityScore: 7.2,
    priorityBand: 'P1',
    summary: 'Stairwell fire, building evacuated.',
    lat: 41.02,
    lng: 28.98,
    geohash: 'sxk9721',
    geohashPrefix: 'sxk97',
    regionId: 'kadikoy',
    createdAt: '2026-08-31T10:00:00.000Z',
    updatedAt: '2026-08-31T10:05:00.000Z',
    // Never permitted on the wire (§5.6).
    text: 'My neighbour Ayse at flat 3 is trapped, call me',
    reporterId: 'user-123',
    reporterContact: '+90 555 000 0000',
    notes: 'Coordinator: possible duplicate of r0',
    ...overrides,
  };
}

function reader(items: Record<string, unknown>[]) {
  const send = vi.fn().mockResolvedValue({ Items: items });
  const client = { send } as unknown as DynamoDBDocumentClient;
  return { reader: createPublicReportReader('ReportTable', client), send };
}

describe('projection', () => {
  it('never asks DynamoDB for a sensitive column in the first place', () => {
    // Layer 1: what is not read cannot leak, even through a later bug.
    for (const forbidden of ['text', 'reporterId', 'reporterContact', 'notes', 'mediaKeys']) {
      expect(PROJECTION_EXPRESSION).not.toContain(forbidden);
    }
  });

  it('requests every field the public projection needs', () => {
    for (const required of ['summary', 'lat', 'lng', 'priorityBand', 'regionId']) {
      expect(PROJECTION_EXPRESSION).toContain(required);
    }
  });
});

describe('createPublicReportReader', () => {
  it('strips reporter identity even when DynamoDB returns it anyway', async () => {
    // Layer 3: the shared allow-list rebuilds each record from scratch, so this
    // holds regardless of what the projection or a future migration returns.
    const { reader: read } = reader([rawItem()]);
    const [report] = await read.list();

    expect(report).toBeDefined();
    expect(Object.keys(report!).sort()).toEqual(
      [
        'category',
        'createdAt',
        'geohash',
        'geohashPrefix',
        'lat',
        'lng',
        'priorityBand',
        'priorityScore',
        'regionId',
        'reportId',
        'status',
        'summary',
        'updatedAt',
        'urgency',
      ].sort(),
    );
    expect(JSON.stringify(report)).not.toContain('Ayse');
    expect(JSON.stringify(report)).not.toContain('user-123');
  });

  it('withholds an incident no human has confirmed', async () => {
    // Layer 2, re-checked in code. An unverified report is an unconfirmed
    // claim; publishing one on a public map broadcasts possibly-false
    // information to everyone in the area.
    const { reader: read } = reader([
      rawItem({ id: 'unverified', status: ReportStatus.AI_CLASSIFIED }),
      rawItem({ id: 'doubtful', status: ReportStatus.NEEDS_VERIFICATION }),
      rawItem({ id: 'false', status: ReportStatus.REJECTED }),
      rawItem({ id: 'confirmed', status: ReportStatus.VERIFIED }),
    ]);

    const reports = await read.list();
    expect(reports.map((r) => r.reportId)).toEqual(['confirmed']);
  });

  it('publishes incidents that are being worked or already handled', async () => {
    const { reader: read } = reader([
      rawItem({ id: 'active', status: ReportStatus.IN_PROGRESS }),
      rawItem({ id: 'done', status: ReportStatus.RESOLVED }),
    ]);
    expect((await read.list()).map((r) => r.reportId)).toEqual(['active', 'done']);
  });

  it('filters non-public statuses in DynamoDB, not only in the Lambda', async () => {
    const { reader: read, send } = reader([]);
    await read.list();

    const input = send.mock.calls[0]?.[0]?.input as {
      FilterExpression: string;
      ExpressionAttributeValues: Record<string, string>;
    };
    expect(input.FilterExpression).toMatch(/#status IN/);
    expect(Object.values(input.ExpressionAttributeValues)).toEqual([
      ReportStatus.VERIFIED,
      ReportStatus.IN_PROGRESS,
      ReportStatus.RESOLVED,
    ]);
  });

  it('clamps a caller-supplied limit so an anonymous request cannot force a huge scan', async () => {
    // `limit` arrives from an unauthenticated caller, which makes an unclamped
    // value a free denial-of-wallet lever.
    const { reader: read, send } = reader([]);

    await read.list(100_000);
    expect((send.mock.calls[0]?.[0]?.input as { Limit: number }).Limit).toBe(
      PUBLIC_REPORT_READ_LIMIT,
    );

    await read.list(0);
    expect((send.mock.calls[1]?.[0]?.input as { Limit: number }).Limit).toBe(1);

    await read.list(25);
    expect((send.mock.calls[2]?.[0]?.input as { Limit: number }).Limit).toBe(25);
  });

  it('returns an empty list rather than throwing when the scan finds nothing', async () => {
    const send = vi.fn().mockResolvedValue({});
    const read = createPublicReportReader('ReportTable', {
      send,
    } as unknown as DynamoDBDocumentClient);
    await expect(read.list()).resolves.toEqual([]);
  });
});
