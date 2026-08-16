import { useCallback, useEffect, useRef, useState } from 'react';

import { assignTeam, AssignError, type AssignErrorCode } from '../../lib/assign-team';

/**
 * React lifecycle for one guarded team assignment (CRIS-32, design doc §5.1).
 * Mirrors `useReportTransition`: wraps `assignTeam` so the coordinator surface
 * gets an idle → submitting → success/error state machine it can render
 * against, without embedding AWS calls in the presentational dashboard.
 *
 * The optimistic lock (§5.3) is surfaced through the `error` state's `code`:
 * `CONFLICT` means the report moved under us, so the caller should refetch the
 * feed (that is exactly what `onSuccess` does on the happy path).
 */

/** A requested assignment. `expectedVersion` is the version the queue last read. */
export interface AssignTeamRequest {
  reportId: string;
  teamId: string;
  expectedVersion: number;
  note?: string;
}

export type AssignTeamUiState =
  | { status: 'idle' }
  | { status: 'submitting'; reportId: string; teamId: string }
  | { status: 'success'; reportId: string; teamId: string; version: number }
  | { status: 'error'; reportId: string; teamId: string; code: AssignErrorCode; message: string };

export interface UseAssignTeam {
  state: AssignTeamUiState;
  /** Apply an assignment; updates `state` through its lifecycle. Never throws. */
  assign: (req: AssignTeamRequest) => Promise<void>;
  /** Return to `idle` (e.g. after the operator dismisses an error). */
  reset: () => void;
}

export function useAssignTeam(opts?: {
  /** Called after a successful assignment — typically re-reads the feed. */
  onSuccess?: () => void;
}): UseAssignTeam {
  const [state, setState] = useState<AssignTeamUiState>({ status: 'idle' });

  // Keep the latest onSuccess without making `assign` change identity every
  // render (the parent passes a fresh options object each time).
  const onSuccessRef = useRef(opts?.onSuccess);
  useEffect(() => {
    onSuccessRef.current = opts?.onSuccess;
  }, [opts?.onSuccess]);

  const assign = useCallback(async (req: AssignTeamRequest) => {
    setState({ status: 'submitting', reportId: req.reportId, teamId: req.teamId });
    try {
      const result = await assignTeam(req);
      setState({
        status: 'success',
        reportId: result.reportId,
        teamId: result.assignedTeamId,
        version: result.version,
      });
      onSuccessRef.current?.();
    } catch (err) {
      setState({
        status: 'error',
        reportId: req.reportId,
        teamId: req.teamId,
        code: err instanceof AssignError ? err.code : 'UNKNOWN',
        message: err instanceof Error ? err.message : 'The team could not be assigned.',
      });
    }
  }, []);

  const reset = useCallback(() => setState({ status: 'idle' }), []);

  return { state, assign, reset };
}
