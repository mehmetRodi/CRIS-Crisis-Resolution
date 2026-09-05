/**
 * publishReportUpdate resolver (design doc §5.3) — CRIS-19.
 *
 * The "notify subscribers" mutation. AppSync subscriptions fire on AppSync
 * *mutations*, not on raw DynamoDB writes, so direct report writers commit
 * durably and then call this to fan the update out. The classification worker
 * and transition resolver use schema-level IAM resource grants; Amplify also
 * requires a per-operation rule, whose narrow client-facing gate is `ADMIN`
 * (ADR-0030). CRIS-28's subscriptions consume the returned projection.
 * Keeping durable writes independent of AppSync availability remains the
 * design requirement.
 *
 * This is a passthrough: its arguments are already the redacted `PublicReport`
 * shape. Because the GraphQL argument type contains only public fields, reporter
 * identity/contact/notes and raw report text cannot travel this channel (§5.6).
 */
import type {
  Category,
  PriorityBand,
  PublicReport,
  ReportStatus,
  Urgency,
} from '@crisismap/shared';

import type { FunctionResolverHandler } from '../appsync-event';

type PublishArgs = {
  reportId: string;
  status: string;
  category?: string | null;
  urgency?: string | null;
  priorityScore?: number | null;
  priorityBand?: string | null;
  summary?: string | null;
  lat?: number | null;
  lng?: number | null;
  geohash?: string | null;
  geohashPrefix?: string | null;
  regionId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export const handler: FunctionResolverHandler<PublishArgs, PublicReport> = async (event) => {
  const a = event.arguments;
  return {
    reportId: a.reportId,
    status: a.status as ReportStatus,
    category: (a.category as Category | undefined) ?? null,
    urgency: (a.urgency as Urgency | undefined) ?? null,
    priorityScore: a.priorityScore ?? null,
    priorityBand: (a.priorityBand as PriorityBand | undefined) ?? null,
    summary: a.summary ?? null,
    lat: a.lat ?? null,
    lng: a.lng ?? null,
    geohash: a.geohash ?? null,
    geohashPrefix: a.geohashPrefix ?? null,
    regionId: a.regionId ?? null,
    createdAt: a.createdAt ?? null,
    updatedAt: a.updatedAt ?? null,
  };
};
