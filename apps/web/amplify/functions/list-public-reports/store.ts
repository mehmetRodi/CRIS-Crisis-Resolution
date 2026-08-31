import { ScanCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  PUBLICLY_VISIBLE_STATUSES,
  isPubliclyVisible,
  toPublicReport,
  type PublicReport,
  type RedactableReport,
  type ReportStatus,
} from '@crisismap/shared';

/**
 * The public-map read (CRIS-54, ADR-0056).
 *
 * This module is the entire trust boundary for the only unauthenticated data
 * path in the product, so it applies redaction in three independent layers.
 * Any one of them alone would be sufficient on a good day; all three are here
 * because the failure mode is publishing a disaster victim's identity.
 *
 *   1. `PROJECTION_EXPRESSION` — DynamoDB never returns the sensitive
 *      attributes at all, so they are not in the Lambda's memory to leak.
 *   2. `FilterExpression`      — non-public statuses are dropped in DynamoDB.
 *   3. `toPublicReport`        — the shared field allow-list rebuilds each
 *      record from scratch rather than deleting keys, so a newly-added
 *      sensitive column cannot pass through by default.
 *
 * Layer 3 is the one that survives a mistake in layers 1 and 2, which is why
 * the shared helper is used rather than returning the scanned item directly.
 */

/** Bounded working set, matching the volunteer projection's precedent. */
export const PUBLIC_REPORT_READ_LIMIT = 250;

/**
 * The attributes DynamoDB is permitted to return.
 *
 * NEVER add `text`, `reporterId`, `reporterContact`, `notes`, `mediaKeys`, or
 * `anonymous` here. `geohash`/`geohashPrefix` are included because they are part
 * of `PublicReport` and are already coarser than the `lat`/`lng` beside them.
 */
export const PROJECTION_EXPRESSION =
  'id, #status, category, urgency, priorityScore, priorityBand, summary, lat, lng, geohash, ' +
  'geohashPrefix, regionId, createdAt, updatedAt';

export interface PublicReportReader {
  list(limit?: number): Promise<PublicReport[]>;
}

export function createPublicReportReader(
  tableName: string,
  client: DynamoDBDocumentClient,
): PublicReportReader {
  return {
    async list(limit = PUBLIC_REPORT_READ_LIMIT) {
      // Build the status filter from the shared constant rather than a literal
      // list, so adding a status to `PUBLICLY_VISIBLE_STATUSES` cannot leave
      // this query behind.
      const statusNames = PUBLICLY_VISIBLE_STATUSES.map((_, index) => `:s${index}`);
      const statusValues = Object.fromEntries(
        PUBLICLY_VISIBLE_STATUSES.map((status, index) => [`:s${index}`, status]),
      );

      const result = await client.send(
        new ScanCommand({
          TableName: tableName,
          // Clamped: `limit` arrives from an unauthenticated caller, so an
          // arbitrarily large value would be a free denial-of-wallet lever.
          Limit: Math.min(Math.max(1, limit), PUBLIC_REPORT_READ_LIMIT),
          ProjectionExpression: PROJECTION_EXPRESSION,
          FilterExpression: `#status IN (${statusNames.join(', ')})`,
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: statusValues,
        }),
      );

      return (
        (result.Items ?? [])
          .map((item) => item as RedactableReport)
          // Re-checked in code even though DynamoDB already filtered: the
          // FilterExpression is one typo away from returning everything, and this
          // assertion costs nothing.
          .filter((report) => isPubliclyVisible(report.status as ReportStatus))
          .map(toPublicReport)
      );
    },
  };
}
