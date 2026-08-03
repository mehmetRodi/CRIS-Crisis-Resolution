import { useCallback, useEffect, useState } from 'react';
import { getCurrentUser } from 'aws-amplify/auth';

import { client } from '../../lib/amplify';
import {
  buildVolunteerTasks,
  type VolunteerAssignmentRecord,
  type VolunteerReportRecord,
  type VolunteerTaskFeedState,
  type VolunteerTeamRecord,
} from './tasks';

/** A bounded one-shot working set until cursor pagination and CRIS-28 subscriptions land. */
const READ_LIMIT = 250;

// Explicit allow-lists are the privacy boundary for this client read. In particular, raw report
// text, reporter identity/contact, notes, and mediaKeys never enter the volunteer UI process.
const REPORT_SELECTION = [
  'id',
  'status',
  'category',
  'urgency',
  'priorityScore',
  'priorityBand',
  'summary',
  'lat',
  'lng',
  'geohash',
  'geohashPrefix',
  'regionId',
  'assignedTeamId',
  'createdAt',
  'updatedAt',
] as const;

const ASSIGNMENT_SELECTION = ['id', 'reportId', 'teamId', 'status', 'createdAt'] as const;
const TEAM_SELECTION = ['id', 'name', 'regionId'] as const;

export interface LiveVolunteerTasks {
  state: VolunteerTaskFeedState;
  refresh: () => void;
}

/**
 * Load and join the existing Report/Assignment/Team read models for the volunteer board.
 * This route is deliberately read-only: generated Assignment updates are not a safe workflow
 * boundary, and no guarded volunteer mutation exists yet (ADR-0039/0040).
 */
export function useVolunteerTasks(): LiveVolunteerTasks {
  const [state, setState] = useState<VolunteerTaskFeedState>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      await getCurrentUser();
    } catch {
      setState({ status: 'unauthenticated' });
      return;
    }

    try {
      const [reportsResult, assignmentsResult, teamsResult] = await Promise.all([
        client.models.Report.list({ limit: READ_LIMIT, selectionSet: REPORT_SELECTION }),
        client.models.Assignment.list({
          limit: READ_LIMIT,
          selectionSet: ASSIGNMENT_SELECTION,
        }),
        client.models.Team.list({ limit: READ_LIMIT, selectionSet: TEAM_SELECTION }),
      ]);
      const firstError = [
        ...(reportsResult.errors ?? []),
        ...(assignmentsResult.errors ?? []),
        ...(teamsResult.errors ?? []),
      ][0];
      if (firstError) {
        setState({ status: 'error', message: firstError.message ?? 'Could not load tasks.' });
        return;
      }

      setState({
        status: 'ready',
        tasks: buildVolunteerTasks(
          (reportsResult.data ?? []) as VolunteerReportRecord[],
          (assignmentsResult.data ?? []) as VolunteerAssignmentRecord[],
          (teamsResult.data ?? []) as VolunteerTeamRecord[],
        ),
      });
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not load tasks.',
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, refresh: () => void load() };
}
