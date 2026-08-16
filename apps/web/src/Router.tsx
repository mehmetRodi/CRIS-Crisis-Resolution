import { useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { UserRole } from '@crisismap/shared';
import { AuthProvider, useAuth } from './AuthContext';
import { OfflineQueueProvider } from './OfflineQueueContext';
import { RequireRole } from './RequireRole';
import App from './App';
import { ReportPage } from './screens/ReportPage';
import { MapPage } from './screens/MapPage';
import LoginPage from './LoginPage';
import SignupPage from './SignupPage';
import ConfirmSignupPage from './ConfirmSignupPage';
import { CoordinatorDashboard } from './surfaces/coordinator/CoordinatorDashboard';
import { useLiveReports } from './surfaces/coordinator/useLiveReports';
import { useReportTransition } from './surfaces/coordinator/useReportTransition';
import { useAssignTeam } from './surfaces/coordinator/useAssignTeam';
import { useTeams } from './surfaces/coordinator/useTeams';
import { useIncidentTimeline } from './surfaces/coordinator/useIncidentTimeline';
import { VolunteerTaskBoard } from './surfaces/volunteer/VolunteerTaskBoard';
import { useVolunteerTasks } from './surfaces/volunteer/useVolunteerTasks';

/**
 * Web routes. The web SPA is chiefly the coordinator/responder/volunteer
 * surface, but `/report` is a citizen emergency-fallback form so anyone with a
 * browser can file a report without installing the mobile app (ADR-0021;
 * mobile remains the primary citizen channel per ADR-0020). The coordinator
 * dashboard shell mounts at `/coordinator` (CRIS-12, ADR-0022); the volunteer
 * task board mounts at `/volunteer` (CRIS-33, ADR-0040); the full-screen live
 * map mounts at `/map` (CRIS-13, ADR-0025). Operational routes are gated by
 * Cognito role via `RequireRole` (CRIS-24, ADR-0041/0042).
 */

/**
 * Wires the presentational dashboard to its data source and router. The live
 * incident feed (`useLiveReports`) degrades gracefully to an `unauthenticated`
 * state when there is no session; `onExit` navigates home (ADR-0022).
 */
function CoordinatorRoute() {
  const navigate = useNavigate();
  const { highestRole } = useAuth();
  const { state, refresh } = useLiveReports();
  // CRIS-23: per-incident audit timeline. The dashboard owns row selection but
  // reports it here so this wrapper can drive the timeline read; nothing is
  // fetched until a row is selected (`selectedId === null` → idle).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { state: timeline, refresh: refreshTimeline } = useIncidentTimeline(selectedId);
  // CRIS-18: guarded status transitions. Re-read the feed AND the timeline after
  // any successful transition so the queue reflects the new status and a fresh
  // optimistic-lock version (§5.3), and the newly-appended audit event appears.
  const { state: transition, transition: applyTransition } = useReportTransition({
    onSuccess: () => {
      refresh();
      refreshTimeline();
    },
  });
  // CRIS-32: guarded team assignment. Same reconciliation as a status
  // transition — re-read the feed and timeline so the queue reflects the new
  // `assignedTeamId` and a fresh optimistic-lock version, and the newly
  // appended `ASSIGNED` audit event appears.
  const { state: assignment, assign: applyAssignTeam } = useAssignTeam({
    onSuccess: () => {
      refresh();
      refreshTimeline();
    },
  });
  const teamsState = useTeams();
  const teams = teamsState.status === 'ready' ? teamsState.teams : [];
  return (
    <CoordinatorDashboard
      onExit={() => navigate('/')}
      feed={state}
      onRefresh={refresh}
      onTransition={(request) => void applyTransition(request)}
      transition={transition}
      onSelectIncident={setSelectedId}
      timeline={timeline}
      onAssignTeam={(request) => void applyAssignTeam(request)}
      assignment={assignment}
      teams={teams}
      // RequireRole (below) only ever mounts this route for COORDINATOR/ADMIN,
      // but falls back to the dashboard's own default if that were ever null.
      callerRole={highestRole ?? undefined}
    />
  );
}

function VolunteerRoute() {
  const navigate = useNavigate();
  const { state, refresh } = useVolunteerTasks();
  return <VolunteerTaskBoard onExit={() => navigate('/')} feed={state} onRefresh={refresh} />;
}

export function Router() {
  return (
    <BrowserRouter>
      <AuthProvider>
        {/* Root-level (CRIS-26), not per-route: the flush loop and
            connectivity subscription must persist across navigation, not
            restart every time ReportForm mounts. */}
        <OfflineQueueProvider>
          <Routes>
            <Route path="/" element={<App />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/confirm-signup" element={<ConfirmSignupPage />} />
            <Route path="/report" element={<ReportPage />} />
            <Route path="/map" element={<MapPage />} />
            <Route
              path="/coordinator"
              element={
                <RequireRole allow={[UserRole.COORDINATOR, UserRole.ADMIN]}>
                  <CoordinatorRoute />
                </RequireRole>
              }
            />
            <Route
              path="/volunteer"
              element={
                <RequireRole
                  allow={[
                    UserRole.VOLUNTEER,
                    UserRole.RESPONDER,
                    UserRole.COORDINATOR,
                    UserRole.ADMIN,
                  ]}
                >
                  <VolunteerRoute />
                </RequireRole>
              }
            />
          </Routes>
        </OfflineQueueProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
