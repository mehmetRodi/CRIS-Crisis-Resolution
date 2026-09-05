import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentUser } from 'aws-amplify/auth';
import type { PublicReport } from '@crisismap/shared';

import { client } from '../../lib/amplify';

/**
 * The public incident feed (CRIS-54, ADR-0056).
 *
 * Backs the unauthenticated `/map` route. Reads `listPublicReports`, which is
 * the only guest-reachable operation in the schema and which enforces BOTH
 * redactions server-side — the `PublicReport` field allow-list and the
 * `PUBLICLY_VISIBLE_STATUSES` incident allow-list. Nothing here filters for
 * safety; a client-side filter over data that already crossed the wire would be
 * theatre.
 *
 * ── Why the auth mode is chosen at call time ───────────────────────────────
 * The operation carries two authorization rules. `allow.guest()` matches the
 * identity pool's UNAUTHENTICATED role; `allow.authenticated()` matches a
 * user-pool token. A signed-in caller does not satisfy the guest rule, and a
 * signed-out one has no user-pool token — so a single hard-coded auth mode
 * breaks exactly half the callers. The session is probed once per load and the
 * mode picked to match.
 */

export type PublicIncidentsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; incidents: PublicReport[] };

export interface UsePublicIncidents {
  state: PublicIncidentsState;
  refresh: () => void;
}

/** Bounded working set; mirrors the server-side clamp in the resolver. */
const READ_LIMIT = 250;

export function usePublicIncidents(): UsePublicIncidents {
  const [state, setState] = useState<PublicIncidentsState>({ status: 'loading' });
  // Guards against an out-of-order response overwriting a newer read.
  const sequenceRef = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++sequenceRef.current;
    setState({ status: 'loading' });

    // A failure here means "no user-pool session", which is the ordinary case
    // for this route — not an error worth surfacing.
    let signedIn = false;
    try {
      await getCurrentUser();
      signedIn = true;
    } catch {
      signedIn = false;
    }

    try {
      let reports: PublicReport[] = [];
      if (typeof client?.queries?.listPublicReports === 'function') {
        const result = await client.queries.listPublicReports(
          { limit: READ_LIMIT },
          { authMode: signedIn ? 'userPool' : 'identityPool' },
        );
        const firstError = result.errors?.[0];
        if (firstError) throw new Error(firstError.message ?? 'Could not load incidents.');
        reports = (result.data ?? []).filter(Boolean) as PublicReport[];
      } else {
        throw new Error('The public incident service is unavailable. Please try again later.');
      }

      if (sequence !== sequenceRef.current) return;
      setState({
        status: 'ready',
        incidents: reports,
      });
    } catch (error) {
      if (sequence !== sequenceRef.current) return;
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not load incidents.',
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, refresh: () => void load() };
}
