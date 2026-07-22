import { useCallback, useEffect, useState } from 'react';
import { getCurrentUser } from 'aws-amplify/auth';
import {
  toPublicReport,
  type Category,
  type ReportStatus,
  type Urgency,
} from '@crisismap/shared';

import { client } from '../../lib/amplify';
import type { Schema } from '../../../amplify/data/resource';
import type { CoordinatorIncident, IncidentFeedState } from './incidents';

/**
 * Live incident feed for the coordinator dashboard (CRIS-12; read path from
 * CRIS-22). Reads the `Report` table through the shared AppSync client and
 * redacts each record to a `PublicReport` before it leaves this hook, so the UI
 * layer never holds reporter PII or the untrusted raw body (design doc §5.6).
 *
 * Reads are gated behind an authenticated Cognito user (`allow.authenticated`
 * on the `Report` model). Sign-in is available; if there is no session this hook
 * degrades gracefully by resolving to `unauthenticated`
 * rather than throwing, and the dashboard shows a "sign in as a coordinator"
 * prompt instead of an error. Group enforcement remains a separate route/API
 * authorization concern.
 *
 * This is a one-shot read plus manual `refresh` — NOT a live subscription.
 * Real-time push (AppSync subscriptions) is owned by CRIS-28; the dashboard's
 * "live updates" indicator stays disconnected until then.
 */

/** How many reports to pull for the queue. Bounded until pagination (CRIS-22). */
const READ_LIMIT = 250;

/**
 * Map a raw AppSync `Report` to the redacted projection the UI uses, plus the
 * optimistic-lock `version` a coordinator needs to drive a transition (CRIS-18).
 * PII is still stripped by `toPublicReport`; `version` is a concurrency token,
 * not reporter data, and rides alongside the public fields (see
 * `CoordinatorIncident`).
 */
function toRedactedIncident(report: Schema['Report']['type']): CoordinatorIncident {
  return {
    ...toPublicReport({
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
    }),
    version: report.version ?? 0,
  };
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

    // Reads require a signed-in user. No session → graceful degrade, not an error.
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
