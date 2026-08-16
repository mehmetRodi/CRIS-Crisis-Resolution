import { useCallback, useEffect, useState } from 'react';
import { getCurrentUser } from 'aws-amplify/auth';

import { client } from '../../lib/amplify';
import { sortTimeline, toTimelineEvent, type IncidentTimelineState } from './incidents';

/**
 * Per-incident audit timeline for the coordinator incident-detail panel
 * (CRIS-23, design doc §5.1). When a coordinator selects a row, this reads that
 * report's immutable `ReportEvent` log and projects each entry to a PII-free
 * `TimelineEvent` (see `toTimelineEvent`) before it reaches the UI.
 *
 * The read goes through the `eventsByReport` secondary index (partition
 * `reportId`, sort `createdAt`) rather than a table scan + filter — it is the
 * access pattern the model was indexed for (§5.1). `ReportEvent` is readable by
 * the COORDINATOR/ADMIN/RESPONDER groups; as with `useLiveReports`, a missing
 * session degrades to an `error` state rather than throwing.
 *
 * `reportId === null` (nothing selected) resolves to `idle` and issues no read.
 * `refresh` re-runs the read. The route wrapper calls it after a successful
 * local transition and when CRIS-28 reports an update for the selected incident
 * (or reconnect recovery), so newly-appended audit events converge without
 * putting internal event detail on the public subscription channel.
 */

/** How many audit events to pull for one incident. Bounded until pagination. */
const TIMELINE_LIMIT = 100;

/**
 * The exact fields the timeline maps (see `toTimelineEvent`). We select these
 * explicitly rather than take the default selection set for a correctness
 * reason, not just economy: `ReportEvent` rows are written directly by the
 * guarded CRIS-18 resolver, which bypasses Amplify's auto-managed `updatedAt`,
 * leaving it null. `updatedAt` is non-nullable in the generated schema, so the
 * default selection set makes AppSync reject the whole query
 * ("Cannot return null for non-nullable type: 'AWSDateTime' … /updatedAt"). Not
 * requesting it sidesteps that; every field below is either required-and-present
 * or nullable. Our own `createdAt` (declared on the model, §5.1) is the ordering
 * key and is populated by the resolver.
 */
const TIMELINE_SELECTION = [
  'id',
  'eventId',
  'type',
  'fromStatus',
  'toStatus',
  'actorId',
  'actorRole',
  'version',
  'detail',
  'createdAt',
] as const;

export interface LiveIncidentTimeline {
  state: IncidentTimelineState;
  /** Re-run the read (e.g. after a status transition appends an event). */
  refresh: () => void;
}

export function useIncidentTimeline(reportId: string | null): LiveIncidentTimeline {
  const [state, setState] = useState<IncidentTimelineState>({ status: 'idle' });

  const load = useCallback(async () => {
    if (!reportId) {
      setState({ status: 'idle' });
      return;
    }
    setState({ status: 'loading' });

    // Reads require a signed-in coordinator/responder. No session → graceful
    // degrade, mirroring the feed hook.
    try {
      await getCurrentUser();
    } catch {
      setState({ status: 'error', message: 'Sign in to view the incident timeline.' });
      return;
    }

    try {
      const { data, errors } = await client.models.ReportEvent.eventsByReport(
        { reportId },
        { limit: TIMELINE_LIMIT, selectionSet: TIMELINE_SELECTION },
      );
      if (errors && errors.length > 0) {
        setState({
          status: 'error',
          message: errors[0]?.message ?? 'Could not load the timeline.',
        });
        return;
      }
      setState({ status: 'ready', events: sortTimeline((data ?? []).map(toTimelineEvent)) });
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Could not load the timeline.',
      });
    }
  }, [reportId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => void load(), [load]);
  return { state, refresh };
}
