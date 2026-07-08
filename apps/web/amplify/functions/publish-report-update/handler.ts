/**
 * publishReportUpdate resolver (design doc §5.3) — CRIS-19.
 *
 * The internal, IAM-only "notify subscribers" mutation. AppSync subscriptions
 * fire on AppSync *mutations*, not on raw DynamoDB writes — so the async worker
 * (CRIS-10) writes the report durably and *then* calls this mutation to fan the
 * redacted update out to subscribed clients (p95 < 2 s, §3.2). Keeping the
 * durable write independent of AppSync availability is the whole point.
 *
 * This is a passthrough: its arguments are already the redacted `PublicReport`
 * shape (produced by `toPublicReport` at the caller). Because the GraphQL
 * argument type contains only public fields, reporter identity/contact/notes and
 * the raw report text physically cannot travel this channel (§5.6).
 */
import type { AppSyncResolverHandler } from 'aws-lambda';
import type {
  Category,
  PriorityBand,
  PublicReport,
  ReportStatus,
  Urgency,
} from '@crisismap/shared';

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

export const handler: AppSyncResolverHandler<PublishArgs, PublicReport> = async (event) => {
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
