import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReportStatus } from '@crisismap/shared';

import {
  transitionReportStatus,
  TransitionError,
  type TransitionErrorCode,
} from '../../lib/transition-report';

/**
 * React lifecycle for one guarded report transition (CRIS-18, design doc §5.1,
 * §5.3). Wraps `transitionReportStatus` so the coordinator surface gets an
 * idle → submitting → success/error state machine it can render against, without
 * embedding AWS calls in the presentational dashboard.
 *
 * The optimistic lock (§5.3) is surfaced through the `error` state's `code`:
 * `CONFLICT` means the report moved under us, so the caller should refetch the
 * feed (that is exactly what `onSuccess` does on the happy path — the route
 * wrapper re-reads after any completed transition to reconcile versions). Other
 * codes (`FORBIDDEN`, `ILLEGAL_TRANSITION`, `NOT_FOUND`) are operator-facing.
 */

/** A requested transition. `expectedVersion` is the version the queue last read. */
export interface TransitionRequest {
  reportId: string;
  toStatus: ReportStatus;
  expectedVersion: number;
  note?: string;
}

export type TransitionUiState =
  | { status: 'idle' }
  | { status: 'submitting'; reportId: string; toStatus: ReportStatus }
  | { status: 'success'; reportId: string; toStatus: ReportStatus; version: number }
  | {
      status: 'error';
      reportId: string;
      toStatus: ReportStatus;
      code: TransitionErrorCode;
      message: string;
    };

export interface UseReportTransition {
  state: TransitionUiState;
  /** Apply a transition; updates `state` through its lifecycle. Never throws. */
  transition: (req: TransitionRequest) => Promise<void>;
  /** Return to `idle` (e.g. after the operator dismisses an error). */
  reset: () => void;
}

export function useReportTransition(opts?: {
  /** Called after a successful transition — typically re-reads the feed. */
  onSuccess?: () => void;
}): UseReportTransition {
  const [state, setState] = useState<TransitionUiState>({ status: 'idle' });

  // Keep the latest onSuccess without making `transition` change identity every
  // render (the parent passes a fresh options object each time).
  const onSuccessRef = useRef(opts?.onSuccess);
  useEffect(() => {
    onSuccessRef.current = opts?.onSuccess;
  }, [opts?.onSuccess]);

  const transition = useCallback(async (req: TransitionRequest) => {
    setState({ status: 'submitting', reportId: req.reportId, toStatus: req.toStatus });
    try {
      const result = await transitionReportStatus(req);
      setState({
        status: 'success',
        reportId: result.reportId,
        toStatus: result.status,
        version: result.version,
      });
      onSuccessRef.current?.();
    } catch (err) {
      setState({
        status: 'error',
        reportId: req.reportId,
        toStatus: req.toStatus,
        code: err instanceof TransitionError ? err.code : 'UNKNOWN',
        message: err instanceof Error ? err.message : 'The report status could not be updated.',
      });
    }
  }, []);

  const reset = useCallback(() => setState({ status: 'idle' }), []);

  return { state, transition, reset };
}
