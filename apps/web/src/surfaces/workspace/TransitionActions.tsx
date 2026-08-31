import { useState } from 'react';
import { ReportStatus, type UserRole } from '@crisismap/shared';
import { Check, CircleX, Loader2, Play, RotateCcw, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { transitionsFor } from '../../lib/capabilities';
import { statusMeta } from '../../lib/domain-display';
import type { CoordinatorIncident } from '../coordinator/incidents';
import type { TransitionRequest, TransitionUiState } from '../coordinator/useReportTransition';

/**
 * Guarded status transitions for the selected incident (CRIS-18 → CRIS-54).
 *
 * The offered moves come from `transitionsFor`, which composes the SAME shared
 * `STATUS_TRANSITIONS` + `canActorTransition` the server resolver uses. So this
 * cannot offer a button the resolver would reject — and when it somehow does
 * (a stale token, a role changed mid-session), the resolver still refuses and
 * the error surfaces below rather than being swallowed.
 */

/** Verb + icon for a move, keyed by destination (and origin, for reopen). */
function moveLabel(from: ReportStatus, to: ReportStatus): { label: string; icon: LucideIcon } {
  switch (to) {
    case ReportStatus.VERIFIED:
      return { label: 'Verify', icon: ShieldCheck };
    case ReportStatus.REJECTED:
      return { label: 'Reject', icon: CircleX };
    case ReportStatus.NEEDS_VERIFICATION:
      return { label: 'Send to verification', icon: TriangleAlert };
    case ReportStatus.RESOLVED:
      return { label: 'Resolve', icon: Check };
    case ReportStatus.IN_PROGRESS:
      return from === ReportStatus.RESOLVED
        ? { label: 'Reopen', icon: RotateCcw }
        : { label: 'Start response', icon: Play };
    default:
      return { label: statusMeta(to).label, icon: Play };
  }
}

/** Moves that are hard to undo get destructive styling, not a neutral button. */
function isDestructive(to: ReportStatus): boolean {
  return to === ReportStatus.REJECTED;
}

export function TransitionActions({
  incident,
  callerRole,
  onTransition,
  transition,
}: {
  incident: CoordinatorIncident;
  callerRole: UserRole;
  onTransition: (request: TransitionRequest) => void;
  transition: TransitionUiState;
}) {
  const [note, setNote] = useState('');
  const from = incident.status;
  const moves = transitionsFor(from, callerRole);

  const forThis = transition.status !== 'idle' && transition.reportId === incident.reportId;
  const submitting = forThis && transition.status === 'submitting';

  if (moves.length === 0) {
    return (
      <p className="text-xs text-fg-muted">
        No status actions are available to you from{' '}
        <span className="font-medium text-fg">{statusMeta(from).label}</span>.
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      <div>
        <label htmlFor="transition-note" className="mb-1.5 block text-xs font-medium text-fg-muted">
          Note (optional)
        </label>
        <Textarea
          id="transition-note"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Recorded permanently on the audit trail"
          className="text-xs"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {moves.map((to) => {
          const { label, icon: Icon } = moveLabel(from, to);
          return (
            <Button
              key={to}
              size="sm"
              variant={isDestructive(to) ? 'destructive' : 'secondary'}
              disabled={submitting}
              onClick={() =>
                onTransition({
                  reportId: incident.reportId,
                  toStatus: to,
                  expectedVersion: incident.version,
                  note: note.trim() || undefined,
                })
              }
            >
              {submitting && transition.status === 'submitting' && transition.toStatus === to ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <Icon aria-hidden="true" />
              )}
              {label}
            </Button>
          );
        })}
      </div>

      {/* Outcome. Only ever rendered for THIS incident — a success message left
          over from the previously-selected report would be a lie about the one
          now on screen. */}
      {forThis && transition.status === 'success' ? (
        <p role="status" className="text-xs font-medium text-success">
          Updated to {statusMeta(transition.toStatus).label}.
        </p>
      ) : null}

      {forThis && transition.status === 'error' ? (
        <p role="alert" className="text-xs font-medium text-danger">
          {transition.code === 'CONFLICT'
            ? // The optimistic lock rejected a stale version: someone else moved
              // this report while it was open. Say what happened and what to do,
              // rather than surfacing the raw resolver error.
              'This report changed while you had it open. Refresh to load the latest version, then try again.'
            : transition.message}
        </p>
      ) : null}
    </div>
  );
}
