import type { TriageEntities, UserRole } from '@crisismap/shared';
import { X } from 'lucide-react';

import { CategoryTag } from '../../components/domain/CategoryTag';
import { PriorityBadge } from '../../components/domain/PriorityBadge';
import { ScoreBreakdown } from '../../components/domain/ScoreBreakdown';
import { StatusBadge } from '../../components/domain/StatusBadge';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/cn';
import type { Capabilities } from '../../lib/capabilities';
import { urgencyLabel } from '../../lib/domain-display';
import { absoluteTime, formatConfidence, formatScore, relativeTime } from '../../lib/format';
import {
  bandOf,
  type CoordinatorIncident,
  type IncidentTimelineState,
} from '../coordinator/incidents';
import type { TransitionRequest, TransitionUiState } from '../coordinator/useReportTransition';
import type { AssignTeamRequest, AssignTeamUiState } from '../coordinator/useAssignTeam';
import type { TeamOption } from '../coordinator/useTeams';
import { AssignTeamAction } from './AssignTeamAction';
import { IncidentTimeline } from './IncidentTimeline';
import { TransitionActions } from './TransitionActions';

/**
 * The incident-detail rail (CRIS-23 → CRIS-54).
 *
 * Ordered by what a coordinator needs in the order they need it: what is this
 * (summary), how bad (priority + score), what did the AI extract, why does it
 * rank there, what has happened to it, and only then what can I do about it.
 * Actions sit at the BOTTOM deliberately — a verify/reject button above the
 * evidence invites acting before reading.
 *
 * Actions are gated by `capabilities`, which mirrors the server's own rules; a
 * volunteer sees the same evidence with no action block at all rather than a row
 * of disabled buttons, because a disabled button is a promise of access that
 * this role will never have.
 */

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('border-t border-border px-4 py-3.5', className)}>
      <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/50 bg-surface-sunken/40 p-2.5">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-fg-subtle">{label}</dt>
      <dd className="truncate text-xs font-semibold text-fg mt-0.5">{value}</dd>
    </div>
  );
}

/** PII-free entities the triage agent extracted (§2.2, Fig 2/Fig 4). */
function Entities({ entities }: { entities: TriageEntities }) {
  const hasAny =
    entities.peopleAffected != null ||
    entities.infrastructure.length > 0 ||
    entities.hazards.length > 0;
  if (!hasAny) return null;

  return (
    <Section title="Extracted details">
      <div className="space-y-3 rounded-xl border border-border/50 bg-surface-sunken/30 p-3">
        {entities.peopleAffected != null ? (
          <p className="text-xs text-fg">
            <span className="tabular font-bold text-accent">{entities.peopleAffected}</span>
            <span className="text-fg-muted"> people affected</span>
          </p>
        ) : null}
        {entities.infrastructure.length > 0 ? (
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-fg-subtle">Infrastructure</p>
            <div className="flex flex-wrap gap-1">
              {entities.infrastructure.map((item) => (
                <Badge key={item} variant="neutral" className="text-[11px]">
                  {item}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
        {entities.hazards.length > 0 ? (
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-fg-subtle">Hazards</p>
            <div className="flex flex-wrap gap-1">
              {entities.hazards.map((item) => (
                <Badge key={item} variant="warning" className="text-[11px]">
                  {item}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Section>
  );
}

export function IncidentDetailPanel({
  incident,
  timeline,
  capabilities,
  callerRole,
  onClose,
  onTransition,
  transition,
  onAssignTeam,
  assignment,
  teams,
  className,
}: {
  incident: CoordinatorIncident;
  timeline: IncidentTimelineState;
  capabilities: Capabilities;
  callerRole: UserRole;
  onClose: () => void;
  onTransition?: (request: TransitionRequest) => void;
  transition: TransitionUiState;
  onAssignTeam?: (request: AssignTeamRequest) => void;
  assignment: AssignTeamUiState;
  teams: readonly TeamOption[];
  className?: string;
}) {
  const band = bandOf(incident);
  const showActions =
    (capabilities.canTransitionStatus && onTransition) ||
    (capabilities.canAssignTeam && onAssignTeam);

  return (
    <aside
      aria-labelledby="incident-detail-heading"
      className={cn('flex min-h-0 flex-col overflow-y-auto bg-surface', className)}
    >
      {/* Sticky so the incident under discussion stays identified while the
          coordinator scrolls to the timeline or the actions. */}
      <header className="sticky top-0 z-10 flex items-start gap-2 border-b border-border/80 bg-surface/90 backdrop-blur-md px-4 py-3 shadow-2xs">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <PriorityBadge band={band} score={incident.priorityScore} />
            <StatusBadge status={incident.status} />
          </div>
          <h2
            id="incident-detail-heading"
            className={cn(
              'mt-2 text-xs font-semibold leading-relaxed',
              incident.summary ? 'text-fg' : 'italic text-fg-subtle',
            )}
          >
            {incident.summary ?? 'Awaiting AI summary'}
          </h2>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close incident detail" className="rounded-lg hover:bg-surface-hover">
          <X aria-hidden="true" className="size-4" />
        </Button>
      </header>

      <Section title="Classification" className="border-t-0">
        <dl className="grid grid-cols-2 gap-2">
          <div className="min-w-0 rounded-xl border border-border/50 bg-surface-sunken/40 p-2.5">
            <dt className="text-[10px] font-bold uppercase tracking-wider text-fg-subtle">
              Category
            </dt>
            <dd className="text-xs font-semibold text-fg mt-0.5">
              <CategoryTag category={incident.category} className="text-xs" />
            </dd>
          </div>
          <Field label="Urgency" value={urgencyLabel(incident.urgency)} />
          <Field
            label="Priority"
            value={band ? `${band} · ${formatScore(incident.priorityScore)}` : 'Not yet scored'}
          />
          <Field label="AI confidence" value={formatConfidence(incident.confidence)} />
          <Field label="Region" value={incident.regionId ?? 'Unresolved'} />
          <Field label="Reported" value={relativeTime(incident.createdAt)} />
        </dl>
      </Section>

      {incident.entities ? <Entities entities={incident.entities} /> : null}

      {incident.scoreBreakdown ? (
        <Section title="Why this priority">
          <ScoreBreakdown breakdown={incident.scoreBreakdown} />
          {incident.scoreVersion != null ? (
            <p className="mt-2.5 text-[11px] text-fg-subtle">
              Scoring formula v{incident.scoreVersion}. Priority is computed deterministically, not
              taken from the model.
            </p>
          ) : null}
        </Section>
      ) : null}

      {capabilities.canViewTimeline ? (
        <Section title="Timeline">
          <IncidentTimeline timeline={timeline} />
        </Section>
      ) : null}

      {showActions ? (
        <Section title="Actions">
          <div className="space-y-4">
            {capabilities.canTransitionStatus && onTransition ? (
              <TransitionActions
                incident={incident}
                callerRole={callerRole}
                onTransition={onTransition}
                transition={transition}
              />
            ) : null}
            {capabilities.canAssignTeam && onAssignTeam ? (
              <div className="border-t border-border pt-3.5">
                <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                  Response team
                </h4>
                <AssignTeamAction
                  incident={incident}
                  teams={teams}
                  onAssignTeam={onAssignTeam}
                  assignment={assignment}
                />
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}

      {/* The full id, never truncated: it is read aloud over radio and pasted
          into other tools. `select-all` makes copying it one click. */}
      <Section title="Reference">
        <dl className="space-y-2">
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
              Report ID
            </dt>
            <dd className="select-all break-all font-mono text-xs text-fg-muted">
              {incident.reportId}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
              Last updated
            </dt>
            <dd className="text-xs text-fg-muted">{absoluteTime(incident.updatedAt)}</dd>
          </div>
        </dl>
      </Section>
    </aside>
  );
}
