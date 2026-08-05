import { useCallback, useEffect, useState } from 'react';
import { getCurrentUser } from 'aws-amplify/auth';

import { client } from '../../lib/amplify';
import type { VolunteerTask, VolunteerTaskFeedState } from './tasks';

export interface LiveVolunteerTasks {
  state: VolunteerTaskFeedState;
  refresh: () => void;
}

/**
 * Load the server-enforced redacted projection for the volunteer board. The
 * browser never receives the underlying Report/Assignment/Team model records.
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
      const result = await client.queries.listVolunteerTasks();
      const firstError = result.errors?.[0];
      if (firstError) {
        setState({ status: 'error', message: firstError.message ?? 'Could not load tasks.' });
        return;
      }

      setState({
        status: 'ready',
        tasks: (result.data ?? []) as VolunteerTask[],
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
