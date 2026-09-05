import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentUser } from 'aws-amplify/auth';

import { client } from '../../lib/amplify';
import { useReportUpdates, type RealtimeConnectionState } from '../../lib/report-updates';
import { reconcileVolunteerReport, type VolunteerTask, type VolunteerTaskFeedState } from './tasks';

export interface LiveVolunteerTasks {
  state: VolunteerTaskFeedState;
  realtime: RealtimeConnectionState;
  refresh: () => void;
}

/**
 * Load the server-enforced redacted projection for the volunteer board. The
 * browser never receives the underlying Report/Assignment/Team model records.
 */
export function useVolunteerTasks(): LiveVolunteerTasks {
  const [state, setState] = useState<VolunteerTaskFeedState>({ status: 'loading' });
  const loadSequence = useRef(0);

  const load = useCallback(async (background = false) => {
    const sequence = ++loadSequence.current;
    if (!background) setState({ status: 'loading' });
    try {
      await getCurrentUser();
    } catch {
      if (sequence === loadSequence.current) setState({ status: 'unauthenticated' });
      return;
    }

    try {
      const result = await client.queries.listVolunteerTasks();
      const firstError = result.errors?.[0];
      if (firstError) {
        throw new Error(firstError.message ?? 'Could not load tasks.');
      }

      if (sequence === loadSequence.current) {
        setState({
          status: 'ready',
          tasks: (result.data ?? []) as VolunteerTask[],
        });
        window.dispatchEvent(new Event('cris:work-updated'));
      }
    } catch (error) {
      if (background) throw error;
      if (sequence === loadSequence.current) {
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not load tasks.',
        });
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const realtime = useReportUpdates({
    enabled: state.status === 'ready',
    onUpdate: (report) => {
      window.dispatchEvent(new Event('cris:work-updated'));
      setState((current) =>
        current.status === 'ready'
          ? { status: 'ready', tasks: reconcileVolunteerReport(current.tasks, report) }
          : current,
      );
    },
    onReconnect: () => load(true),
  });

  return { state, realtime, refresh: () => void load() };
}
