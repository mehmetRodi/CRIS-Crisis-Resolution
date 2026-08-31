import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { UserRole } from '@crisismap/shared';
import { ClipboardList, Map as MapIcon, RefreshCw } from 'lucide-react';

import { useAuth } from '../../AuthContext';
import { ConnectionStatus } from '../../components/domain/ConnectionStatus';
import { EmptyState } from '../../components/domain/EmptyState';
import { Button } from '../../components/ui/button';
import { capabilitiesFor } from '../../lib/capabilities';
import { AppShell, type ShellNavItem } from '../../shell/AppShell';
import { useIncidentTimeline } from '../coordinator/useIncidentTimeline';
import { useLiveReports } from '../coordinator/useLiveReports';
import { useAssignTeam } from '../coordinator/useAssignTeam';
import { useReportTransition } from '../coordinator/useReportTransition';
import { useTeams } from '../coordinator/useTeams';
import { useVolunteerTasks } from '../volunteer/useVolunteerTasks';
import { IncidentWorkspace } from './IncidentWorkspace';
import { TaskWorkspace } from './TaskWorkspace';

/**
 * Workspace routes (CRIS-54, ADR-0055).
 *
 * ── Why two route components instead of one branching component ────────────
 * `useLiveReports` and `useVolunteerTasks` each fire a query on mount, and hooks
 * cannot be called conditionally. A single component that branched on role would
 * therefore run BOTH — sending a volunteer's browser at the staff-only `Report`
 * read on every visit, producing a guaranteed authorization failure and a
 * pointless round trip. Splitting the routes means each role mounts only the
 * reads it is actually entitled to make.
 */

/** Destinations this role may open. Volunteers have no incident feed to show. */
function navFor(canReadIncidentFeed: boolean): ShellNavItem[] {
  const nav: ShellNavItem[] = [];
  if (canReadIncidentFeed) {
    nav.push({ to: '/workspace/incidents', label: 'Incidents', icon: MapIcon });
  }
  nav.push({ to: '/workspace/tasks', label: 'Tasks', icon: ClipboardList });
  return nav;
}

/**
 * `/workspace` — send the caller to the pane their role actually works from.
 *
 * A shared landing page listing "the surfaces available to you" is a menu
 * standing between a responder and the incident they were paged about. The
 * workspace they need is knowable from their role, so route straight there.
 */
export function WorkspaceIndexRoute() {
  const { loading, isAuthenticated, highestRole } = useAuth();
  const capabilities = capabilitiesFor(highestRole);

  // Don't decide a destination from a half-resolved session — it would bounce
  // an authenticated coordinator through the sign-in page on every reload.
  if (loading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  // A signed-in account with no operational group has nowhere to be redirected
  // TO. Explain that here rather than bouncing them into a route gate, which
  // would report "you don't have access to this page" and leave them guessing
  // which page they should be trying instead.
  if (!capabilities.isOperational) return <NoRoleRoute />;

  return (
    <Navigate
      to={capabilities.view === 'incidents' ? '/workspace/incidents' : '/workspace/tasks'}
      replace
    />
  );
}

/** `/workspace/incidents` — the map-first incident workspace. */
export function IncidentWorkspaceRoute() {
  const { highestRole } = useAuth();
  const capabilities = capabilitiesFor(highestRole);

  const { state: feed, realtime, lastUpdate, activity, refresh } = useLiveReports();

  // Selection lives at the route level because it drives BOTH the presentation
  // and a data read (the per-incident timeline). Nothing is fetched until a row
  // is selected — `null` leaves the timeline hook idle.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { state: timeline, refresh: refreshTimeline } = useIncidentTimeline(selectedId);

  // CRIS-28: an update to the selected report — or a reconnect, signalled by a
  // null reportId, where any number of events may have been missed — invalidates
  // its audit timeline.
  useEffect(() => {
    if (selectedId && lastUpdate && (!lastUpdate.reportId || lastUpdate.reportId === selectedId)) {
      refreshTimeline();
    }
  }, [lastUpdate, refreshTimeline, selectedId]);

  // Both guarded mutations reconcile the same way: re-read the feed so the queue
  // reflects the new state AND a fresh optimistic-lock version, and re-read the
  // timeline so the newly-appended audit event appears.
  const reconcile = () => {
    refresh();
    refreshTimeline();
  };
  const { state: transition, transition: applyTransition } = useReportTransition({
    onSuccess: reconcile,
  });
  const { state: assignment, assign: applyAssignTeam } = useAssignTeam({ onSuccess: reconcile });

  const teamsState = useTeams();
  const teams = teamsState.status === 'ready' ? teamsState.teams : [];

  const nav = useMemo(
    () => navFor(capabilities.canReadIncidentFeed),
    [capabilities.canReadIncidentFeed],
  );

  return (
    <AppShell
      nav={nav}
      actions={
        <>
          <ConnectionStatus state={realtime} />
          <Button
            variant="secondary"
            size="sm"
            onClick={refresh}
            disabled={feed.status === 'loading'}
          >
            <RefreshCw aria-hidden="true" />
            <span className="hidden sm:inline">Refresh</span>
            <span className="sr-only sm:hidden">Refresh incidents</span>
          </Button>
        </>
      }
    >
      <IncidentWorkspace
        feed={feed}
        realtime={realtime}
        activity={activity}
        timeline={timeline}
        capabilities={capabilities}
        // `RequireRole` only mounts this route for feed-capable roles, so the
        // fallback is unreachable in practice; it exists so the component has a
        // total type rather than a nullable role threaded through every action.
        callerRole={highestRole ?? UserRole.RESPONDER}
        selectedId={selectedId}
        onSelectIncident={setSelectedId}
        onTransition={
          capabilities.canTransitionStatus ? (request) => void applyTransition(request) : undefined
        }
        transition={transition}
        onAssignTeam={
          capabilities.canAssignTeam ? (request) => void applyAssignTeam(request) : undefined
        }
        assignment={assignment}
        teams={teams}
      />
    </AppShell>
  );
}

/** `/workspace/tasks` — the redacted regional task board. */
export function TaskWorkspaceRoute() {
  const { highestRole } = useAuth();
  const capabilities = capabilitiesFor(highestRole);
  const { state, realtime, refresh } = useVolunteerTasks();
  const nav = useMemo(
    () => navFor(capabilities.canReadIncidentFeed),
    [capabilities.canReadIncidentFeed],
  );

  return (
    <AppShell
      nav={nav}
      actions={
        <>
          <ConnectionStatus state={realtime} />
          <Button
            variant="secondary"
            size="sm"
            onClick={refresh}
            disabled={state.status === 'loading'}
          >
            <RefreshCw aria-hidden="true" />
            <span className="hidden sm:inline">Refresh</span>
            <span className="sr-only sm:hidden">Refresh tasks</span>
          </Button>
        </>
      }
    >
      <TaskWorkspace feed={state} />
    </AppShell>
  );
}

/**
 * Shown when a signed-in account holds no operational Cognito group. Distinct
 * from `RequireRole`'s denial: that one refuses a specific route, this one says
 * the account has no workspace at all yet, which needs an administrator rather
 * than a different URL.
 */
export function NoRoleRoute() {
  const navigate = useNavigate();
  return (
    <AppShell nav={[]}>
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          title="No operational role assigned"
          description="Your account is signed in but has not been added to a response group yet. An administrator needs to grant you a role before the workspace becomes available."
          action={
            <Button variant="secondary" size="sm" onClick={() => navigate('/report')}>
              Submit a report instead
            </Button>
          }
        />
      </div>
    </AppShell>
  );
}
