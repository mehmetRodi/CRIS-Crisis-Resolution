import { Link } from 'react-router-dom';

import { IncidentMap } from '../surfaces/map/IncidentMap';

/**
 * Full-screen live incident map route (`/map`, CRIS-13, ADR-0025).
 *
 * The same {@link IncidentMap} base map that fills the coordinator dashboard's
 * "Live map" region, given its own deep-linkable route (the App landing "Live
 * map" card opens it). Base map only — incident markers/clustering remain
 * deferred. This route is intentionally public and must consume only
 * `PublicReport`-shaped data once incident overlays land (ADR-0041).
 */
export function MapPage() {
  return (
    <main className="flex h-screen flex-col bg-slate-50 text-slate-900">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-3">
        <Link
          to="/"
          className="text-sm text-slate-500 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          ← CrisisMap AI
        </Link>
        <h1 className="text-lg font-bold tracking-tight">Live incident map</h1>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
          CRIS-13
        </span>
      </header>
      <div className="relative flex-1">
        <IncidentMap className="absolute inset-0" />
      </div>
    </main>
  );
}
