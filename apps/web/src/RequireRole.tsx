import type { ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import type { UserRole } from '@crisismap/shared';

import { useAuth } from './AuthContext';
import { Button } from './components/ui/button';
import { roleLabel } from './lib/domain-display';

/**
 * Route-level role gate (CRIS-24, ADR-0041).
 *
 * The SERVER remains the real gate — schema group rules and the guarded
 * resolvers reject an unauthorized caller regardless of what the browser
 * renders. This only stops someone loading a surface they could never operate,
 * which is a usability guarantee rather than a security one.
 *
 * The sign-in redirect carries the attempted path in router state, so a user
 * who followed a deep link to a specific incident lands back on it after
 * authenticating instead of being dumped at a generic home page.
 */
export function RequireRole({
  allow,
  children,
}: {
  /** Groups permitted to view this route. */
  allow: readonly UserRole[];
  children: ReactNode;
}) {
  const { loading, isAuthenticated, highestRole } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Render nothing while the session resolves. Showing either the content or a
  // denial here would flash the wrong one on every reload.
  if (loading) return null;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!highestRole || !allow.includes(highestRole)) {
    return (
      // A real `<h1>` rather than the generic `EmptyState`: this is a whole page,
      // and a page with no heading leaves a screen-reader user with nothing to
      // navigate to and no announcement of why the route they followed did not
      // open. `role="alert"` announces the denial immediately on arrival.
      <main className="flex min-h-dvh items-center justify-center bg-bg px-6">
        <div
          role="alert"
          className="flex max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-10 text-center"
        >
          <ShieldAlert aria-hidden="true" className="size-6 text-danger" />
          <h1 className="text-lg font-semibold tracking-tight text-fg">
            You don&apos;t have access to this page
          </h1>
          <p className="text-sm leading-relaxed text-fg-muted">
            {highestRole
              ? `You are signed in as ${roleLabel(highestRole)}. This page is limited to ${allow
                  .map((role) => roleLabel(role))
                  .join(', ')}.`
              : 'Your account has not been added to a response group yet. An administrator needs to grant you a role.'}
          </p>
          <Button variant="secondary" size="sm" onClick={() => navigate('/')} className="mt-2">
            Back to home
          </Button>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
