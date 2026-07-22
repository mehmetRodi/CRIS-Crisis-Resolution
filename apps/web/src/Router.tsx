import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import App from './App';
import { ReportPage } from './screens/ReportPage';
import { MapPage } from './screens/MapPage';
import LoginPage from './LoginPage';
import SignupPage from './SignupPage';
import ConfirmSignupPage from './ConfirmSignupPage';
import { CoordinatorDashboard } from './surfaces/coordinator/CoordinatorDashboard';
import { useLiveReports } from './surfaces/coordinator/useLiveReports';
import { useReportTransition } from './surfaces/coordinator/useReportTransition';

/**
 * Web routes. The web SPA is chiefly the coordinator/responder/volunteer
 * surface, but `/report` is a citizen emergency-fallback form so anyone with a
 * browser can file a report without installing the mobile app (ADR-0021;
 * mobile remains the primary citizen channel per ADR-0020). The coordinator
 * dashboard shell mounts at `/coordinator` (CRIS-12, ADR-0022); the full-screen
 * live map mounts at `/map` (CRIS-13, ADR-0025). Authentication routes exist;
 * coordinator group enforcement at the route boundary remains deferred.
 */

/**
 * Wires the presentational dashboard to its data source and router. The live
 * incident feed (`useLiveReports`) degrades gracefully to an `unauthenticated`
 * state when there is no session; `onExit` navigates home (ADR-0022).
 */
function CoordinatorRoute() {
  const navigate = useNavigate();
  const { state, refresh } = useLiveReports();
  // CRIS-18: guarded status transitions. Re-read the feed after any successful
  // transition so the queue reflects the new status and a fresh optimistic-lock
  // version (§5.3).
  const { state: transition, transition: applyTransition } = useReportTransition({
    onSuccess: refresh,
  });
  return (
    <CoordinatorDashboard
      onExit={() => navigate('/')}
      feed={state}
      onRefresh={refresh}
      onTransition={(request) => void applyTransition(request)}
      transition={transition}
    />
  );
}

export function Router() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/confirm-signup" element={<ConfirmSignupPage />} />
          <Route path="/report" element={<ReportPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/coordinator" element={<CoordinatorRoute />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
