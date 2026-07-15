import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import App from './App';
import { ReportPage } from './screens/ReportPage';
import { CoordinatorDashboard } from './surfaces/coordinator/CoordinatorDashboard';
import { useLiveReports } from './surfaces/coordinator/useLiveReports';

/**
 * Web routes. The web SPA is chiefly the coordinator/responder/volunteer
 * surface, but `/report` is a citizen emergency-fallback form so anyone with a
 * browser can file a report without installing the mobile app (ADR-0021;
 * mobile remains the primary citizen channel per ADR-0020). The coordinator
 * dashboard shell mounts at `/coordinator` (CRIS-12, ADR-0022); the map route
 * is added by CRIS-13. Route-level auth/role-gating arrives with CRIS-7.
 */

/**
 * Wires the presentational dashboard to its data source and router. The live
 * incident feed (`useLiveReports`) degrades gracefully to an `unauthenticated`
 * state until sign-in lands (CRIS-7); `onExit` navigates home (ADR-0022).
 */
function CoordinatorRoute() {
  const navigate = useNavigate();
  const { state, refresh } = useLiveReports();
  return <CoordinatorDashboard onExit={() => navigate('/')} feed={state} onRefresh={refresh} />;
}

export function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/report" element={<ReportPage />} />
        <Route path="/coordinator" element={<CoordinatorRoute />} />
      </Routes>
    </BrowserRouter>
  );
}
