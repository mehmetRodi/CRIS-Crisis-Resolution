import { ReportStatus, UserRole } from '@crisismap/shared';
import CitizenReportPage from './CitizenReportPage';
/**
 * Placeholder application shell.
 *
 * This is intentionally a static landing surface for the scaffold. The four
 * real role surfaces below are stubs; each is built by its owning ticket:
 *   - Citizen submission form   → CRIS-6
 *   - Coordinator dashboard     → CRIS-12
 *   - Live map                  → CRIS-13
 *   - Volunteer task board      → CRIS-4 epic (E4)
 * Routing/auth wiring is added with CRIS-7. See docs/architecture.md.
 */

interface Surface {
  title: string;
  role: string;
  ticket: string;
  description: string;
}

const SURFACES: Surface[] = [
  {
    title: 'Citizen submission',
    role: UserRole.CITIZEN,
    ticket: 'CRIS-6',
    description: 'Fast free-text emergency report with optional location, media, and anonymity.',
  },
  {
    title: 'Coordinator dashboard',
    role: UserRole.COORDINATOR,
    ticket: 'CRIS-12',
    description: 'Real-time, de-duplicated, priority-ordered incident view.',
  },
  {
    title: 'Live map',
    role: UserRole.COORDINATOR,
    ticket: 'CRIS-13',
    description: 'MapLibre + Amazon Location incident map with clustering and heatmaps.',
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
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <header className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight">CrisisMap AI</h1>
          <p className="mt-2 text-slate-600">
            Real-time serverless disaster intelligence and emergency coordination platform.
          </p>
          <span className="mt-3 inline-block rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
            Scaffold — surfaces below are placeholders
          </span>
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
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{surface.title}</h3>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {surface.ticket}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{surface.description}</p>
                <p className="mt-2 text-xs text-slate-400">Primary role: {surface.role}</p>
              </li>
            ))}
          </ul>
        </section>
        <hr className="my-12 border-slate-300" />

        <CitizenReportPage />
      </div>
    </main>
  );
}

export default App;
