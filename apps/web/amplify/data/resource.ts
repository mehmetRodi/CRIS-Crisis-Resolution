import { a, defineData, type ClientSchema } from '@aws-amplify/backend';

/**
 * GraphQL data model (AppSync + DynamoDB) — design doc §5.2, §5.3.
 *
 * STUB — deliberately ONE minimal `Report` model so the schema compiles and the
 * frontend has a shape to code against. This is NOT the real data model.
 *
 * TODO(CRIS-8): full entity set (Verification, DuplicateGroup, Assignment, Team,
 *   AlertSubscription, AlertDelivery, ReportEvent, Region, CategoryConfig,
 *   IdempotencyRecord), the six GSIs, geohash location fields, and a separate
 *   PublicReport projection so identity/contact never leak (§5.3).
 * TODO(CRIS-9): `submitReport` mutation + optimistic-lock (expectedVersion)
 *   conditional writes, plus the IAM-only `publishReportUpdate` mutation that
 *   drives subscriptions (§5.3).
 *
 * NOTE: enum members are inlined here because `a.enum()` requires a literal
 * array. They MUST stay in sync with `@crisismap/shared` (ReportStatus /
 * Category / Urgency), which is the source of truth.
 */
const schema = a.schema({
  Report: a
    .model({
      text: a.string().required(),
      status: a.enum([
        'NEW',
        'PROCESSING',
        'AI_CLASSIFIED',
        'NEEDS_VERIFICATION',
        'VERIFIED',
        'IN_PROGRESS',
        'RESOLVED',
        'REJECTED',
      ]),
      category: a.enum([
        'MEDICAL',
        'RESCUE',
        'STRUCTURAL_DAMAGE',
        'FIRE',
        'FLOOD',
        'HAZMAT',
        'BLOCKED_ROAD',
        'SHELTER',
        'UTILITY',
        'OTHER',
      ]),
      urgency: a.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
      priorityScore: a.float(),
      // Optimistic-lock version (§5.3). Enforcement is added with CRIS-9.
      version: a.integer(),
    })
    // Coarse rules for the scaffold. TODO(CRIS-7/CRIS-8): role- and
    // ownership-scoped rules + redacted public projection.
    .authorization((allow) => [allow.authenticated(), allow.guest().to(['read'])]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
