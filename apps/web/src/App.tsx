import { ReportStatus, UserRole } from '@crisismap/shared';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

/**
 * Application landing page.
 *
 * This landing surface links to the implemented web routes. The web SPA
 * serves coordinators/responders/volunteers; the mobile app (`apps/mobile`,
 * CRIS-6 — see ADR 0020) is the primary citizen channel, with `/report` as a
 * web emergency fallback (ADR 0021). Surface ownership:
 *   - Coordinator dashboard     → CRIS-12 (shell landed at /coordinator; ADR-0022)
 *   - Live map                  → CRIS-13 (base map at /map; ADR-0025)
 *   - Volunteer task board      → CRIS-4 epic (E4)
 *
 * Cards whose shell exists navigate via the router (ADR-0021). Auth is optional
 * (CRIS-7, ADR-0024): sign-in is available but nothing here is gated behind it.
 * See docs/architecture.md.
 */

interface Surface {
  title: string;
  role: string;
  ticket: string;
  description: string;
  /** The route this surface opens, if its shell has landed. */
  path?: string;
}

const SURFACES: Surface[] = [
  {
    title: 'Citizen submission',
    role: UserRole.CITIZEN,
    ticket: 'CRIS-6',
    description:
      'Fast free-text emergency report with optional media and anonymity. Primary channel ' +
      'is the mobile app; this web form is the emergency fallback (ADR-0021).',
    path: '/report',
  },
  {
    title: 'Coordinator dashboard',
    role: UserRole.COORDINATOR,
    ticket: 'CRIS-12',
    description: 'Real-time, de-duplicated, priority-ordered incident view.',
    path: '/coordinator',
  },
  {
    title: 'Live map',
    role: UserRole.COORDINATOR,
    ticket: 'CRIS-13',
    description: 'MapLibre + Amazon Location incident map with clustering and heatmaps.',
    path: '/map',
  },
  {
    title: 'Volunteer task board',
    role: UserRole.VOLUNTEER,
    ticket: 'E4',
    description: 'Regional task intake, assignment, and verification workflow.',
  },
];

const LIFECYCLE = Object.values(ReportStatus);

function App() {
  const { email, signOut, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const handleCardClick = (path?: string) => {
    if (path) {
      navigate(path);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <header className="mb-10 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">CrisisMap AI</h1>
            <p className="mt-2 text-slate-600">
              Real-time serverless disaster intelligence and emergency coordination platform.
            </p>
          </div>
          <div className="flex items-center gap-4">
            {isAuthenticated ? (
              <>
                <span className="text-sm text-slate-600">👤 {email}</span>
                <button onClick={handleSignOut} className="text-sm text-red-600 hover:text-red-800">
                  Sign Out
                </button>
              </>
            ) : (
              <button
                onClick={() => navigate('/login')}
                className="text-sm font-medium text-blue-600 hover:text-blue-800"
              >
                Sign In
              </button>
            )}
          </div>
        </header>

        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Report lifecycle
          </h2>
          <div className="flex flex-wrap gap-2">
            {LIFECYCLE.map((status) => (
              <span
                key={status}
                className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium"
              >
                {status}
              </span>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Surfaces
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {SURFACES.map((surface) => (
              <li
                key={surface.title}
                onClick={() => handleCardClick(surface.path)}
                onKeyDown={(e) => {
                  if (surface.path && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    handleCardClick(surface.path);
                  }
                }}
                role={surface.path ? 'button' : undefined}
                tabIndex={surface.path ? 0 : undefined}
                className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${
                  surface.path
                    ? 'cursor-pointer transition-all hover:border-blue-400 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500'
                    : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{surface.title}</h3>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {surface.ticket}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{surface.description}</p>
                <p className="mt-2 text-xs text-slate-400">Primary role: {surface.role}</p>
                {surface.path ? (
                  <p className="mt-2 text-xs font-medium text-slate-500">Open shell →</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

export default App;
