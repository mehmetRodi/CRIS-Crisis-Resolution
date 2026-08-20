import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentUser } from 'aws-amplify/auth';
import {
  parseEntities,
  parseScoreBreakdown,
  toPublicReport,
  type Category,
  type ReportStatus,
  type Urgency,
} from '@crisismap/shared';

import { client } from '../../lib/amplify';
import { useReportUpdates, type RealtimeConnectionState } from '../../lib/report-updates';
import type { Schema } from '../../../amplify/data/resource';
import {
  reconcileIncident,
  type CoordinatorIncident,
  type IncidentFeedState,
  type ReportActivity,
} from './incidents';

/**
 * Live incident feed for the coordinator dashboard (CRIS-12; read path from
 * CRIS-22). Reads the `Report` table through the shared AppSync client and
 * redacts each record to a `PublicReport` before it leaves this hook, so the UI
 * layer never holds reporter PII or the untrusted raw body (design doc §5.6).
 *
 * Reads are gated to the `COORDINATOR`/`ADMIN`/`RESPONDER` Cognito groups
 * (`Report` model authorization, CRIS-24/ADR-0041/0042 — no blanket
 * `allow.authenticated()` remains, since `Report` carries reporter PII). If there
 * is no session this hook degrades gracefully by resolving to `unauthenticated`
 * rather than throwing, and the dashboard shows a "sign in as a coordinator"
 * prompt instead of an error. The `/coordinator` route itself is further gated to
 * `COORDINATOR`/`ADMIN` only via `RequireRole` (`Router.tsx`).
 *
 * CRIS-28 keeps the bounded list as the durable initial snapshot, then listens
 * to the redacted `onReportUpdate` stream. Each signal is reconciled through a
 * staff-authorized `Report.get` before entering the UI so the coordinator-only
 * detail fields and optimistic-lock `version` stay current. After a WebSocket
 * gap, the hook reloads the snapshot to recover any missed events (ADR-0048).
 */

/** How many reports to pull for the queue. Bounded until pagination (CRIS-22). */
const READ_LIMIT = 250;
const ACTIVITY_LIMIT = 20;

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
      // AI summary now persisted by the triage worker (CRIS-19); the map/queue
      // shows this, never the untrusted raw `text` (§5.6).
      summary: report.summary,
      lat: report.lat,
      lng: report.lng,
      geohash: report.geohash,
      geohashPrefix: report.geohashPrefix,
      regionId: report.regionId,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    }),
    version: report.version ?? 0,
    // Coordinator-internal triage context for the incident-detail view (CRIS-23).
    // Non-PII and already present on the loaded row — no extra read. The two
    // `a.json()` columns are untyped at read time, so parse them defensively
    // through the shared validators (both never throw; malformed → null/empty).
    confidence: report.confidence ?? null,
    scoreVersion: report.scoreVersion ?? null,
    scoreBreakdown: parseScoreBreakdown(report.scoreBreakdown),
    entities: report.entities != null ? parseEntities(report.entities) : null,
    assignedTeamId: report.assignedTeamId ?? null,
  };
}

export interface LiveReportsFeed {
  state: IncidentFeedState;
  /** AppSync WebSocket lifecycle for the dashboard's live-status indicator. */
  realtime: RealtimeConnectionState;
  /**
   * Monotonic activity signal for sibling read models. `reportId: null` means a
   * reconnect snapshot may contain updates for any selected incident.
   */
  lastUpdate: { sequence: number; reportId: string | null } | null;
  /** Redacted subscription events received during this browser session. */
  activity: ReportActivity[];
  /** Re-run the read (e.g. the header refresh button). */
  refresh: () => void;
}

export function useLiveReports(): LiveReportsFeed {
  const [state, setState] = useState<IncidentFeedState>({ status: 'loading' });
  const [lastUpdate, setLastUpdate] = useState<LiveReportsFeed['lastUpdate']>(null);
  const [activity, setActivity] = useState<ReportActivity[]>([]);
  const loadSequence = useRef(0);
  const updateSequence = useRef(0);

  const load = useCallback(async (background = false) => {
    const sequence = ++loadSequence.current;
    if (!background) setState({ status: 'loading' });

    // Reads require a signed-in user. No session → graceful degrade, not an error.
    try {
      await getCurrentUser();
    } catch {
      if (sequence === loadSequence.current) setState({ status: 'unauthenticated' });
      return;
    }

    try {
      const { data, errors } = await client.models.Report.list({ limit: READ_LIMIT });
      if (errors && errors.length > 0) {
        throw new Error(errors[0]?.message ?? 'Could not load incidents.');
      }
      if (sequence === loadSequence.current) {
        setState({ status: 'ready', incidents: (data ?? []).map(toRedactedIncident) });
      }
    } catch (err) {
      if (background) throw err;
      if (sequence === loadSequence.current) {
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Could not load incidents.',
        });
      }
    }
  }, []);

  const reconcile = useCallback(async (reportId: string) => {
    const { data, errors } = await client.models.Report.get({ id: reportId });
    if (errors && errors.length > 0) {
      throw new Error(errors[0]?.message ?? 'Could not reconcile the live incident update.');
    }
    if (!data) throw new Error('The updated incident could not be found.');

    const incoming = toRedactedIncident(data);
    setState((current) =>
      current.status === 'ready'
        ? {
            status: 'ready',
            incidents: reconcileIncident(current.incidents, incoming, READ_LIMIT),
          }
        : current,
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const realtime = useReportUpdates({
    enabled: state.status === 'ready',
    onUpdate: async (report) => {
      await reconcile(report.reportId);
      const sequence = ++updateSequence.current;
      setLastUpdate({ sequence, reportId: report.reportId });
      setActivity((current) =>
        [
          {
            sequence,
            reportId: report.reportId,
            status: report.status,
            summary: report.summary,
            occurredAt: report.updatedAt,
          },
          ...current,
        ].slice(0, ACTIVITY_LIMIT),
      );
    },
    onReconnect: async () => {
      await load(true);
      setLastUpdate({ sequence: ++updateSequence.current, reportId: null });
    },
  });

  return { state, realtime, lastUpdate, activity, refresh: () => void load() };
}
