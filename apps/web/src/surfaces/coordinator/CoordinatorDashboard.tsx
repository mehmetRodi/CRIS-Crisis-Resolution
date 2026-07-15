import type { ReactNode } from 'react';
import { Category, PriorityBand, ReportStatus, UserRole } from '@crisismap/shared';

/**
 * Coordinator dashboard — shell (CRIS-12).
 *
 * The real-time command view coordinators work from (design doc §2.4, Fig 1 &
 * Fig 11). This ticket delivers the **shell only**: the layout, the named
 * regions, and the seams into which the feature tickets plug. Every region is a
 * labeled placeholder that names its owning ticket — nothing here fetches data,
 * renders a map, or drives an action.
 *
 * Region → owning ticket (Fig 11 interaction map):
 *   - Filters (category / status / region)        → CRIS-22
 *   - Live map (Amazon Location + MapLibre)        → CRIS-13
 *   - Priority-ordered incident queue              → CRIS-22
 *   - Incident detail (summary / score / timeline) → CRIS-23
 *   - Guarded response actions                     → CRIS-32
 *   - Recent activity (audit timeline)             → CRIS-28
 *   - Live-update connection (subscriptions)       → CRIS-28
 *
 * The surface mounts at the `/coordinator` route (see ADR-0022); the router
 * itself arrived with ADR-0021. Auth/role-gating of that route is intentionally
 * out of scope here — it arrives with CRIS-7.
 */

interface CoordinatorDashboardProps {
  /** Navigate back to the scaffold overview. Router-agnostic: the route wrapper
   * wires this to the router (ADR-0022) so the component stays presentational. */
  onExit: () => void;
}

/** A metric tile in the top command strip (Fig 1: "incident metrics"). */
interface PriorityTile {
  band: PriorityBand;
  label: string;
  /** Border accent so bands are visually distinct at a glance (design doc §2.4). */
  accent: string;
}

const PRIORITY_TILES: readonly PriorityTile[] = [
  { band: PriorityBand.P0, label: 'Critical', accent: 'border-l-red-500' },
  { band: PriorityBand.P1, label: 'High', accent: 'border-l-orange-500' },
  { band: PriorityBand.P2, label: 'Elevated', accent: 'border-l-amber-400' },
  { band: PriorityBand.P3, label: 'Routine', accent: 'border-l-slate-400' },
];

/** Category / status filter facets (design doc §2.4 "filter by …"). CRIS-22. */
const CATEGORIES = Object.values(Category);
const STATUSES = Object.values(ReportStatus);

// Derives an `aria-labelledby` id from a region title. Assumes region titles are
// unique within the dashboard (they are — see the fixed set below); two regions
// sharing a title would produce duplicate element ids and invalid ARIA.
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * A dashboard region: a titled panel tagged with the ticket that will fill it.
 * When `children` are omitted it renders a "built in <ticket>" placeholder so
 * the seam is obvious and self-documenting.
 */
function Region({
  title,
  ticket,
  hint,
  children,
  className,
}: {
  title: string;
  ticket: string;
  hint: string;
  children?: ReactNode;
  className?: string;
}) {
  const headingId = `region-${slugify(title)}`;
  return (
    <section
      aria-labelledby={headingId}
      className={`flex flex-col rounded-lg border border-slate-200 bg-white shadow-sm ${className ?? ''}`}
    >
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 id={headingId} className="text-sm font-semibold text-slate-700">
          {title}
        </h2>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
          {ticket}
        </span>
      </header>
      <div className="flex-1 p-4">
        {children ?? (
          <div className="flex h-full min-h-[6rem] items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50/60 p-4 text-center">
            <p className="text-xs text-slate-500">
              {hint} <span className="text-slate-400">— built in {ticket}</span>
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/** A read-only facet chip. Non-interactive until the queue lands (CRIS-22). */
function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600">
      {children}
    </span>
  );
}

export function CoordinatorDashboard({ onExit }: CoordinatorDashboardProps) {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      {/* Command bar */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold tracking-tight">Coordinator dashboard</h1>
            <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">
              {UserRole.COORDINATOR}
            </span>
            <span className="hidden rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 sm:inline">
              Shell — CRIS-12
            </span>
          </div>
          <div className="flex items-center gap-3">
            {/* Real-time connection indicator — wired by subscriptions (CRIS-28). */}
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-500"
              title="Live updates arrive with CRIS-28 (AppSync subscriptions)"
            >
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-slate-300" />
              Live updates: not connected
            </span>
            <button
              type="button"
              onClick={onExit}
              className="rounded border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Overview
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        {/* Incident metrics strip (Fig 1). Counts arrive with the queue (CRIS-22). */}
        <section aria-labelledby="metrics-heading" className="mb-6">
          <h2 id="metrics-heading" className="sr-only">
            Incident metrics
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {PRIORITY_TILES.map((tile) => (
              <div
                key={tile.band}
                className={`rounded-lg border border-slate-200 border-l-4 bg-white p-4 shadow-sm ${tile.accent}`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {tile.band}
                  </span>
                  <span className="text-xs text-slate-400">{tile.label}</span>
                </div>
                {/* Placeholder count — live figures land with CRIS-22 / CRIS-28. */}
                <p
                  className="mt-1 text-2xl font-bold tabular-nums text-slate-300"
                  aria-hidden="true"
                >
                  —
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Filters (Fig 11). Interactive filtering is CRIS-22. */}
        <Region
          title="Filters"
          ticket="CRIS-22"
          hint="Filter incidents by category, status, and region"
          className="mb-6"
        >
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Category
              </p>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map((category) => (
                  <Chip key={category}>{category}</Chip>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Status
              </p>
              <div className="flex flex-wrap gap-1.5">
                {STATUSES.map((status) => (
                  <Chip key={status}>{status}</Chip>
                ))}
              </div>
            </div>
            <p className="text-xs text-slate-400">
              Facets are read-only in the shell; interactive filtering is built in CRIS-22.
            </p>
          </div>
        </Region>

        {/* Main working area: map + queue on the left, detail rail on the right. */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            <Region
              title="Live map"
              ticket="CRIS-13"
              hint="Amazon Location + MapLibre incident map with category-coloured markers"
              className="min-h-[20rem]"
            />
            <Region
              title="Priority incident queue"
              ticket="CRIS-22"
              hint="De-duplicated, priority-ordered incident table with row selection"
              className="min-h-[16rem]"
            />
          </div>

          <div className="flex flex-col gap-6">
            <Region
              title="Incident detail"
              ticket="CRIS-23"
              hint="Selected incident: AI summary, score breakdown, and timeline"
              className="min-h-[12rem]"
            >
              <div className="space-y-3">
                <p className="text-sm text-slate-500">No incident selected.</p>
                <p className="text-xs text-slate-400">
                  Selecting a row in the queue opens summary, score breakdown, and timeline here
                  (CRIS-23).
                </p>
                {/* Guarded response actions (verify / assign / merge / resolve) — CRIS-32. */}
                <div className="flex flex-wrap gap-2 pt-1">
                  {['Verify', 'Reject', 'Assign team', 'Resolve'].map((action) => (
                    <button
                      key={action}
                      type="button"
                      disabled
                      className="cursor-not-allowed rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-400"
                      title="Guarded actions are built in CRIS-32"
                    >
                      {action}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-400">Actions are guarded and wired in CRIS-32.</p>
              </div>
            </Region>

            <Region
              title="Recent activity"
              ticket="CRIS-28"
              hint="Live audit stream of status changes and classifications"
              className="min-h-[10rem]"
            />

            <Region
              title="Category distribution"
              ticket="CRIS-22"
              hint="Breakdown of active incidents by category"
              className="min-h-[10rem]"
            />
          </div>
        </div>
      </main>
    </div>
  );
}
