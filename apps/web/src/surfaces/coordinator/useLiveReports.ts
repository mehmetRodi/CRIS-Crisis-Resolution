import { useCallback, useEffect, useState } from 'react';
import { getCurrentUser } from 'aws-amplify/auth';
import {
  toPublicReport,
  type Category,
  type PublicReport,
  type ReportStatus,
  type Urgency,
} from '@crisismap/shared';

import { client } from '../../lib/amplify';
import type { Schema } from '../../../amplify/data/resource';
import type { IncidentFeedState } from './incidents';

/**
 * Live incident feed for the coordinator dashboard (CRIS-12; read path from
 * CRIS-22). Reads the `Report` table through the shared AppSync client and
 * redacts each record to a `PublicReport` before it leaves this hook, so the UI
 * layer never holds reporter PII or the untrusted raw body (design doc §5.6).
 *
 * Reads are gated behind an authenticated Cognito user (`allow.authenticated`
 * on the `Report` model). Sign-in is not built yet (CRIS-7), so this hook
 * DEGRADES GRACEFULLY: if there is no session it resolves to `unauthenticated`
 * rather than throwing, and the dashboard shows a "sign in as a coordinator"
 * prompt instead of an error. Once sign-in lands, the same code path returns
 * live incidents with no change here.
 *
 * This is a one-shot read plus manual `refresh` — NOT a live subscription.
 * Real-time push (AppSync subscriptions) is owned by CRIS-28; the dashboard's
 * "live updates" indicator stays disconnected until then.
 */

/** How many reports to pull for the queue. Bounded until pagination (CRIS-22). */
const READ_LIMIT = 250;

/** Map a raw AppSync `Report` to the redacted, PII-free projection the UI uses. */
function toRedactedIncident(report: Schema['Report']['type']): PublicReport {
  return toPublicReport({
    id: report.id,
    status: (report.status ?? 'NEW') as ReportStatus,
    category: report.category as Category | null,
    urgency: report.urgency as Urgency | null,
    priorityScore: report.priorityScore,
    priorityBand: report.priorityBand,
    lat: report.lat,
    lng: report.lng,
    geohash: report.geohash,
    geohashPrefix: report.geohashPrefix,
    regionId: report.regionId,
    createdAt: report.createdAt,
  });
}

export interface LiveReportsFeed {
  state: IncidentFeedState;
  /** Re-run the read (e.g. the header refresh button). */
  refresh: () => void;
}

export function useLiveReports(): LiveReportsFeed {
  const [state, setState] = useState<IncidentFeedState>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });

    // Reads require a signed-in coordinator. No session → graceful degrade,
    // not an error (sign-in arrives with CRIS-7).
    try {
      await getCurrentUser();
    } catch {
      setState({ status: 'unauthenticated' });
      return;
    }

    try {
      const { data, errors } = await client.models.Report.list({ limit: READ_LIMIT });
      if (errors && errors.length > 0) {
        setState({ status: 'error', message: errors[0]?.message ?? 'Could not load incidents.' });
        return;
      }
      setState({ status: 'ready', incidents: (data ?? []).map(toRedactedIncident) });
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Could not load incidents.',
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, refresh: () => void load() };
}
