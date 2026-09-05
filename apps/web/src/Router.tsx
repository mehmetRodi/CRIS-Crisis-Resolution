import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { UserRole } from '@crisismap/shared';

import { AuthProvider } from './AuthContext';
import { OfflineQueueProvider } from './OfflineQueueContext';
import { RequireRole } from './RequireRole';
import { TooltipProvider } from './components/ui/tooltip';
import { OPERATIONAL_ROLES } from './lib/capabilities';
import ConfirmSignupPage from './ConfirmSignupPage';
import LoginPage from './LoginPage';
import SignupPage from './SignupPage';
import { InformationPage } from './screens/InformationPage';
import { LandingPage } from './screens/LandingPage';
import { NotFoundPage } from './screens/NotFoundPage';
import { ReportPage } from './screens/ReportPage';
import { PublicMapPage } from './surfaces/map/PublicMapPage';
import {
  IncidentWorkspaceRoute,
  TaskWorkspaceRoute,
  WorkspaceIndexRoute,
} from './surfaces/workspace/WorkspaceRoutes';

/**
 * Web routes (CRIS-54, ADR-0055).
 *
 * Three tiers, and the tier a route belongs to is the security decision:
 *
 *   PUBLIC       `/`, `/report`, `/map` — no session required. `/map` reads the
 *                guest-authorized `listPublicReports` (ADR-0056); the other two
 *                read nothing. `/report` stays open because an emergency leaves
 *                no time to create an account (ADR-0021/0024).
 *   AUTH         `/login`, `/signup`, `/confirm-signup`.
 *   OPERATIONAL  `/workspace/*` — gated by Cognito group via `RequireRole`
 *                (CRIS-24, ADR-0041). The gate here is a usability guarantee;
 *                the server's schema rules and guarded resolvers are the actual
 *                enforcement.
 *
 * `/coordinator` and `/volunteer` are kept as permanent redirects rather than
 * removed: they were the shipped URLs before the workspace consolidation, and
 * they are exactly the kind of link that ends up bookmarked or pasted into an
 * incident channel. Breaking them during a crisis is not an acceptable cost of
 * a rename.
 */

/** Roles permitted into the staff incident feed (`Report` model auth). */
const INCIDENT_ROLES = [UserRole.RESPONDER, UserRole.COORDINATOR, UserRole.ADMIN] as const;

export function Router() {
  return (
    <BrowserRouter>
      <AuthProvider>
        {/* Root-level (CRIS-26), not per-route: the flush loop and connectivity
            subscription must persist across navigation, not restart every time
            the report form mounts. */}
        <OfflineQueueProvider>
          {/* One provider for the whole app so tooltips share a single delay
              timer — per-tooltip providers make the first hover in a toolbar
              slow and every subsequent one instant, which reads as jitter. */}
          <TooltipProvider delayDuration={300}>
            <Routes>
              {/* Public */}
              <Route path="/" element={<LandingPage />} />
              <Route path="/report" element={<ReportPage />} />
              <Route path="/map" element={<PublicMapPage />} />

              {(['about', 'help', 'privacy', 'terms'] as const).map((kind) => (
                <Route key={kind} path={`/${kind}`} element={<InformationPage kind={kind} />} />
              ))}

              {/* Auth */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/confirm-signup" element={<ConfirmSignupPage />} />

              {/* Operational */}
              <Route path="/workspace" element={<WorkspaceIndexRoute />} />
              <Route
                path="/workspace/incidents"
                element={
                  <RequireRole allow={INCIDENT_ROLES}>
                    <IncidentWorkspaceRoute />
                  </RequireRole>
                }
              />
              <Route
                path="/workspace/tasks"
                element={
                  <RequireRole allow={OPERATIONAL_ROLES}>
                    <TaskWorkspaceRoute />
                  </RequireRole>
                }
              />

              {/* Legacy URLs from before the workspace consolidation. */}
              <Route path="/coordinator" element={<Navigate to="/workspace/incidents" replace />} />
              <Route path="/volunteer" element={<Navigate to="/workspace/tasks" replace />} />

              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </TooltipProvider>
        </OfflineQueueProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
