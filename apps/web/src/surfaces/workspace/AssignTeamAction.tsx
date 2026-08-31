import { useEffect, useState } from 'react';
import { Loader2, Users } from 'lucide-react';

import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import type { CoordinatorIncident } from '../coordinator/incidents';
import type { AssignTeamRequest, AssignTeamUiState } from '../coordinator/useAssignTeam';
import type { TeamOption } from '../coordinator/useTeams';

/**
 * Guarded team assignment (CRIS-32 → CRIS-54). Coordinator/administrator only —
 * `assignTeam` carries a `COORDINATOR`/`ADMIN` group rule with no per-actor
 * matrix behind it, so `capabilities.canAssignTeam` is the whole client gate.
 *
 * Rendered independently of the status actions: a report can be assigned a team
 * regardless of which transitions happen to be legal from its current state.
 */
export function AssignTeamAction({
  incident,
  teams,
  onAssignTeam,
  assignment,
}: {
  incident: CoordinatorIncident;
  teams: readonly TeamOption[];
  onAssignTeam: (request: AssignTeamRequest) => void;
  assignment: AssignTeamUiState;
}) {
  const [teamId, setTeamId] = useState('');

  // Reset the picker when the selection moves to another incident, so a team
  // chosen for one report is not left staged against the next one.
  useEffect(() => {
    setTeamId('');
  }, [incident.reportId]);

  const forThis = assignment.status !== 'idle' && assignment.reportId === incident.reportId;
  const submitting = forThis && assignment.status === 'submitting';
  const assignedTeam = teams.find((team) => team.id === incident.assignedTeamId);

  if (incident.assignedTeamId) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-fg-muted">
        <Users aria-hidden="true" className="size-3.5 shrink-0" />
        Assigned to{' '}
        <span className="font-medium text-fg">
          {/* Fall back to the raw id: a team deleted or not yet loaded must not
              render as "Assigned to undefined". */}
          {assignedTeam?.name ?? incident.assignedTeamId}
        </span>
      </p>
    );
  }

  if (teams.length === 0) {
    return <p className="text-xs text-fg-muted">No response teams are available to assign.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Select value={teamId} onValueChange={setTeamId}>
          <SelectTrigger aria-label="Response team" className="flex-1">
            <SelectValue placeholder="Select a team…" />
          </SelectTrigger>
          <SelectContent>
            {teams.map((team) => (
              <SelectItem key={team.id} value={team.id}>
                {team.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="primary"
          disabled={!teamId || submitting}
          onClick={() =>
            onAssignTeam({
              reportId: incident.reportId,
              teamId,
              expectedVersion: incident.version,
            })
          }
        >
          {submitting ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
          Assign
        </Button>
      </div>

      {forThis && assignment.status === 'success' ? (
        <p role="status" className="text-xs font-medium text-success">
          Team assigned.
        </p>
      ) : null}

      {forThis && assignment.status === 'error' ? (
        <p role="alert" className="text-xs font-medium text-danger">
          {assignment.code === 'CONFLICT'
            ? 'This report changed while you had it open. Refresh to load the latest version, then try again.'
            : assignment.message}
        </p>
      ) : null}
    </div>
  );
}
