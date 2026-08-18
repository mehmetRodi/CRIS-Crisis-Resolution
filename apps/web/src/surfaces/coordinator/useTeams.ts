import { useEffect, useState } from 'react';

import { client } from '../../lib/amplify';

/**
 * Response teams available for assignment (CRIS-32). A minimal, one-shot read
 * of the `Team` model — just enough for the incident-detail team picker, not a
 * team-management surface. `Team` authorization already allows COORDINATOR/
 * ADMIN/RESPONDER read (`data/resource.ts`).
 */
export interface TeamOption {
  id: string;
  name: string;
}

export type TeamsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; teams: TeamOption[] };

export function useTeams(): TeamsState {
  const [state, setState] = useState<TeamsState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data, errors } = await client.models.Team.list();
        if (cancelled) return;
        if (errors && errors.length > 0) {
          setState({ status: 'error', message: errors[0]?.message ?? 'Could not load teams.' });
          return;
        }
        setState({
          status: 'ready',
          teams: (data ?? [])
            .filter((team) => team.active !== false)
            .map((team) => ({ id: team.id, name: team.name })),
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Could not load teams.',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
