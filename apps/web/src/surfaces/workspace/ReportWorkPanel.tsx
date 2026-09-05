import { useCallback, useEffect, useRef, useState } from 'react';
import {
  canCoordinateWork,
  UserRole,
  WorkAction,
  WORK_NOTE_MAX_LENGTH,
  type ReportWorkView,
} from '@crisismap/shared';
import { Check, Loader2, RefreshCw, UserCheck } from 'lucide-react';
import { client } from '../../lib/amplify';
import { relativeTime } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';

export function ReportWorkPanel({
  reportId,
  callerRole,
}: {
  reportId: string;
  callerRole: UserRole;
}) {
  const [work, setWork] = useState<ReportWorkView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [note, setNote] = useState('');
  const [person, setPerson] = useState('');
  const active = useRef(true);
  const sequence = useRef(0);
  const coordinate = canCoordinateWork(callerRole);
  const load = useCallback(async () => {
    const seq = ++sequence.current;
    setLoading(true);
    setError('');
    try {
      if (typeof client.queries.getReportWork !== 'function')
        throw new Error(
          'Claims and progress updates are currently unavailable. Contact your coordinator.',
        );
      const result = await client.queries.getReportWork({ reportId });
      if (result.errors?.[0] || !result.data)
        throw new Error(result.errors?.[0]?.message ?? 'Could not load report ownership.');
      if (active.current && seq === sequence.current) setWork(result.data as ReportWorkView);
    } catch (failure) {
      if (active.current && seq === sequence.current)
        setError(failure instanceof Error ? failure.message : 'Could not load report ownership.');
    } finally {
      if (active.current && seq === sequence.current) setLoading(false);
    }
  }, [reportId]);
  useEffect(() => {
    active.current = true;
    void load();
    const mountedSequence = sequence.current;
    return () => {
      active.current = false;
      sequence.current = mountedSequence + 1;
    };
  }, [load]);
  async function update(action: WorkAction) {
    if (!work || busy || loading) return;
    if (action === WorkAction.NOTE && !note.trim()) {
      setError('Write a progress update first.');
      document.getElementById(`work-note-${reportId}`)?.focus();
      return;
    }
    if (action === WorkAction.ASSIGN && !person.trim()) {
      setError('Enter the person’s sign-in email.');
      document.getElementById(`work-person-${reportId}`)?.focus();
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await client.mutations.updateReportWork({
        reportId,
        expectedVersion: work.version,
        action,
        ...(action === WorkAction.NOTE ? { note } : {}),
        ...(action === WorkAction.ASSIGN ? { targetUsername: person.trim() } : {}),
      });
      if (result.errors?.[0] || !result.data)
        throw new Error(result.errors?.[0]?.message ?? 'The update could not be saved.');
      if (!active.current) return;
      setWork(result.data as ReportWorkView);
      if (action === WorkAction.NOTE) setNote('');
      if (action === WorkAction.ASSIGN) setPerson('');
      setNotice(
        action === WorkAction.NOTE
          ? 'Progress update saved.'
          : action === WorkAction.RELEASE
            ? 'Claim released.'
            : action === WorkAction.CLAIM
              ? 'You claimed this report.'
              : 'Person assigned.',
      );
      window.dispatchEvent(new Event('cris:work-updated'));
    } catch (failure) {
      if (active.current)
        setError(failure instanceof Error ? failure.message : 'The update could not be saved.');
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <section
      aria-label="Ownership and progress"
      className="space-y-4 rounded-xl border border-border bg-bg p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <UserCheck className="size-4 text-accent" aria-hidden="true" />
          Ownership & progress
        </h3>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh ownership"
          disabled={busy || loading}
          onClick={() => void load()}
        >
          <RefreshCw aria-hidden="true" />
        </Button>
      </div>
      <p role="status" className={loading || notice ? 'text-xs text-fg-muted' : 'sr-only'}>
        {loading ? 'Loading ownership…' : notice}
      </p>
      <p
        role="alert"
        className={error ? 'break-words text-xs leading-relaxed text-danger' : 'sr-only'}
      >
        {error}
      </p>
      {work ? (
        <>
          <p className="text-sm font-medium">
            {work.isMine
              ? 'You are responsible for this report'
              : work.assigneeLabel
                ? `Assigned to ${work.assigneeLabel}`
                : 'No person assigned yet'}
          </p>
          {work.canClaim ? (
            <Button
              size="sm"
              aria-disabled={busy || loading}
              onClick={() => void update(WorkAction.CLAIM)}
            >
              {busy ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Check aria-hidden="true" />
              )}
              Claim report
            </Button>
          ) : !work.assigneeLabel ? (
            <p className="text-xs text-fg-muted">
              A report must be verified before someone can claim it.
            </p>
          ) : null}
          {work.assigneeLabel && (work.isMine || coordinate) ? (
            <Button
              size="sm"
              variant="secondary"
              aria-disabled={busy || loading}
              onClick={() => void update(WorkAction.RELEASE)}
            >
              Release claim
            </Button>
          ) : null}
          {coordinate && work.canClaim ? (
            <div className="space-y-2 border-t border-border pt-4">
              <Label htmlFor={`work-person-${reportId}`}>Assign a person</Label>
              <Input
                id={`work-person-${reportId}`}
                type="email"
                value={person}
                onChange={(event) => setPerson(event.target.value)}
                placeholder="Team member’s sign-in email"
              />
              <p className="text-xs leading-relaxed text-fg-muted">
                Use an enabled volunteer or responder account.
              </p>
              <Button
                size="sm"
                variant="secondary"
                aria-disabled={busy || loading}
                onClick={() => void update(WorkAction.ASSIGN)}
              >
                Assign person
              </Button>
            </div>
          ) : null}
          {work.canEdit ? (
            <div className="space-y-2 border-t border-border pt-4">
              <Label htmlFor={`work-note-${reportId}`}>Progress update</Label>
              <Textarea
                id={`work-note-${reportId}`}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={WORK_NOTE_MAX_LENGTH}
                rows={3}
                placeholder="What have you done? What help is still needed?"
                aria-describedby={`work-note-hint-${reportId}`}
              />
              <p
                id={`work-note-hint-${reportId}`}
                className="text-xs leading-relaxed text-fg-muted"
              >
                Visible to the assigned person and coordinators. Keep reporter names and contact
                details out.
              </p>
              <Button
                size="sm"
                aria-disabled={busy || loading}
                onClick={() => void update(WorkAction.NOTE)}
              >
                Save update
              </Button>
            </div>
          ) : null}
          {work.updates.length ? (
            <div className="space-y-3 border-t border-border pt-4">
              <h4 className="text-xs font-semibold text-fg-muted">Recent progress</h4>
              <ol className="space-y-3">
                {[...work.updates].reverse().map((entry) => (
                  <li key={entry.id} className="rounded-lg border border-border bg-surface p-3">
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                      {entry.text}
                    </p>
                    <p className="mt-2 text-[11px] text-fg-muted">
                      {entry.authorLabel} · {relativeTime(entry.createdAt)}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
