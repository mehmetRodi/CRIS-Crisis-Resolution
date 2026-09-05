import { useCallback, useEffect, useState } from 'react';
import { client } from '../../lib/amplify';
export function useMyReportWork() {
  const [state, setState] = useState<{
    status: 'loading' | 'ready' | 'error';
    ids: string[];
    message?: string;
  }>({ status: 'loading', ids: [] });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    window.addEventListener('cris:work-updated', refresh);
    return () => window.removeEventListener('cris:work-updated', refresh);
  }, [refresh]);
  useEffect(() => {
    let active = true;
    setState((value) => ({ ...value, status: 'loading' }));
    void (async () => {
      try {
        if (typeof client.queries.listMyReportWork !== 'function')
          throw new Error(
            'Personal task assignments are currently unavailable. You can still browse active tasks.',
          );
        const result = await client.queries.listMyReportWork();
        if (result.errors?.[0]) throw new Error(result.errors[0].message);
        if (active)
          setState({
            status: 'ready',
            ids: (result.data ?? []).filter((id): id is string => typeof id === 'string'),
          });
      } catch (error) {
        if (active)
          setState({
            status: 'error',
            ids: [],
            message: error instanceof Error ? error.message : 'Could not load your tasks.',
          });
      }
    })();
    return () => {
      active = false;
    };
  }, [revision]);
  return { ...state, refresh };
}
