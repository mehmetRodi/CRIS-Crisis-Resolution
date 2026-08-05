import type { ReactNode } from 'react';
import { Navigate, Link } from 'react-router-dom';
import type { UserRole } from '@crisismap/shared';
import { useAuth } from './AuthContext';

/**
 * Route-level role gate (CRIS-24, ADR-0041).
 *
 * Closes the gap named in ADR-0028/docs/architecture.md: authenticated routes
 * (e.g. `/coordinator`) previously required only *a* session, not a specific
 * Cognito group — any signed-in user, including a bare `CITIZEN`, could reach
 * them. The server-side mutation/schema authorization remains the real gate;
 * this only prevents an unauthorized user from loading the surface at all.
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

  // Don't flash a redirect/denial while the session is still resolving.
  if (loading) return null;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!highestRole || !allow.includes(highestRole)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Not authorized</h1>
          <p className="mt-2 text-sm text-slate-600">
            Your account doesn&apos;t have access to this page.
          </p>
          <Link
            to="/"
            className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            ← Back to overview
          </Link>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
