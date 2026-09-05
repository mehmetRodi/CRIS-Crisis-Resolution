import { UserRole } from '@crisismap/shared';
import { ReportWorkPanel } from './ReportWorkPanel';
import { MapPin, ShieldCheck } from 'lucide-react';
import { DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { PriorityBadge } from '../../components/domain/PriorityBadge';
import { StatusBadge } from '../../components/domain/StatusBadge';
import { CategoryTag } from '../../components/domain/CategoryTag';
import { ASSIGNMENT_STATUS_META, urgencyLabel } from '../../lib/domain-display';
import { relativeTime } from '../../lib/format';
import { IncidentMap } from '../map/IncidentMap';
import { usePublicIncidents } from '../map/usePublicIncidents';
import type { VolunteerTask } from '../volunteer/tasks';

/** Fetch only the existing public projection; never read the staff Report model. */
export function TaskDetail({
  task,
  callerRole = UserRole.VOLUNTEER,
}: {
  task: VolunteerTask;
  callerRole?: UserRole;
}) {
  const { state, refresh } = usePublicIncidents();
  const incident =
    state.status === 'ready'
      ? state.incidents.find((item) => item.reportId === task.reportId)
      : null;
  const located =
    incident &&
    incident.lat != null &&
    incident.lng != null &&
    Number.isFinite(incident.lat) &&
    Number.isFinite(incident.lng);
  return (
    <div className="overflow-y-auto">
      <div className="border-b border-border p-6 pr-12">
        <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-accent">
          Task details
        </p>
        <DialogTitle className="text-2xl leading-snug tracking-tight">
          {task.summary ?? 'Awaiting incident summary'}
        </DialogTitle>
        <DialogDescription>
          Review the situation and coordinate your next step with your team.
        </DialogDescription>
        <div className="mt-5 flex flex-wrap gap-2">
          <PriorityBadge band={task.priorityBand ?? null} />
          <StatusBadge status={task.status} />
          <CategoryTag category={task.category ?? null} />
        </div>
      </div>
      <div className="space-y-6 p-6">
        <ReportWorkPanel key={task.reportId} reportId={task.reportId} callerRole={callerRole} />
        <dl className="grid grid-cols-2 gap-5 rounded-2xl border border-border bg-bg p-5 text-sm">
          {[
            ['Region', task.regionId ?? 'Not yet assigned'],
            ['Response team', task.teamName ?? 'Not yet assigned'],
            ['Urgency', task.urgency ? urgencyLabel(task.urgency) : 'Awaiting assessment'],
            [
              'Assignment',
              task.assignmentStatus
                ? ASSIGNMENT_STATUS_META[task.assignmentStatus].label
                : 'Not yet assigned',
            ],
            ['Reported', relativeTime(task.createdAt)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-fg-muted">{label}</dt>
              <dd className="mt-1.5 break-words font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        <section aria-labelledby="task-location-heading">
          <h3
            id="task-location-heading"
            className="mb-3 flex items-center gap-2 text-sm font-semibold"
          >
            <MapPin className="size-4 text-accent" aria-hidden="true" />
            Incident location
          </h3>
          {located ? (
            <>
              <div className="h-72 overflow-hidden rounded-2xl border border-border">
                <IncidentMap
                  key={task.reportId}
                  incidents={[incident]}
                  selectedId={task.reportId}
                />
              </div>
              <p className="mt-2 text-xs text-fg-muted">
                Published location · {incident.lat?.toFixed(4)}, {incident.lng?.toFixed(4)}
              </p>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-border-strong bg-bg p-6">
              <p role="status" className="text-sm font-medium">
                {state.status === 'loading'
                  ? 'Loading task location…'
                  : state.status === 'error'
                    ? 'Could not load the task location'
                    : 'Location not available yet'}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">
                {state.status === 'error'
                  ? state.message
                  : 'A map appears when this incident has a confirmed, published location. Ask your coordinator for location guidance.'}
              </p>
              {state.status === 'error' ? (
                <Button className="mt-4" variant="secondary" size="sm" onClick={refresh}>
                  Retry location
                </Button>
              ) : null}
            </div>
          )}
        </section>
        <div className="flex items-start gap-3 rounded-xl bg-accent-subtle p-4">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-accent-subtle-fg">
            Check with your coordinator before heading out. Viewing a task does not assign it to
            you. Reporter contact details are kept private.
          </p>
        </div>
      </div>
    </div>
  );
}
