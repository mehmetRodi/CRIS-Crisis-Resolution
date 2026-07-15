import type { ReactNode } from 'react';
import {
  Category,
  PriorityBand,
  ReportStatus,
  UserRole,
  type PublicReport,
} from '@crisismap/shared';
import {
  bandOf,
  countByBand,
  countByCategory,
  countUnscored,
  sortByPriority,
  type IncidentFeedState,
} from './incidents';

/**
 * Coordinator dashboard (CRIS-12 shell + live read path).
 *
 * The real-time command view coordinators work from (design doc §2.4, Fig 1 &
 * Fig 11). The shell landed with CRIS-12; this iteration WIRES the read path:
 * the metrics strip, the priority-ordered incident queue, and the category
 * distribution now render live `Report` data supplied via the `feed` prop. The
 * component stays presentational — the route wrapper owns the data source
 * (`useLiveReports`) so the layout is trivially testable with a fixture feed.
 *
 * The `feed` is a small state machine (see `IncidentFeedState`). It defaults to
 * `idle`, which reproduces the original shell (placeholders, "—" metrics) so
 * the component renders with no backend session — the state unit tests rely on
 * this. When no coordinator is signed in the route passes `unauthenticated`,
 * and the queue shows a sign-in prompt rather than erroring (reads are gated
 * until CRIS-7 lands).
 *
 * Region → owning ticket (Fig 11 interaction map):
 *   - Filters (category / status / region)        → CRIS-22 (facets read-only)
 *   - Live map (Amazon Location + MapLibre)        → CRIS-13
 *   - Priority-ordered incident queue              → live here; filters CRIS-22
 *   - Incident detail (summary / score / timeline) → CRIS-23
 *   - Guarded response actions                     → CRIS-32
 *   - Recent activity (audit timeline)             → CRIS-28
 *   - Live-update push (subscriptions)             → CRIS-28
 *
 * This is a one-shot read with a manual refresh, NOT a live subscription — the
 * "live updates" indicator stays disconnected until CRIS-28. Auth/role-gating
 * of the route is CRIS-7.
 */

interface CoordinatorDashboardProps {
  /** Navigate back to the scaffold overview. Router-agnostic: the route wrapper
   * wires this to the router (ADR-0022) so the component stays presentational. */
  onExit: () => void;
  /** Incident feed. Defaults to `idle` (the pre-wired shell). */
  feed?: IncidentFeedState;
  /** Re-run the read. Rendered as a header button when the feed is live. */
  onRefresh?: () => void;
}

/** A metric tile in the top command strip (Fig 1: "incident metrics"). */
interface PriorityTile {
  band: PriorityBand;
  label: string;
  /** Border accent so bands are visually distinct at a glance (design doc §2.4). */
  accent: string;
  /** Badge classes for the band chip in the queue. */
  badge: string;
}

const PRIORITY_TILES: readonly PriorityTile[] = [
  { band: PriorityBand.P0, label: 'Critical', accent: 'border-l-red-500', badge: 'bg-red-100 text-red-700' }, // prettier-ignore
  { band: PriorityBand.P1, label: 'High', accent: 'border-l-orange-500', badge: 'bg-orange-100 text-orange-700' }, // prettier-ignore
  { band: PriorityBand.P2, label: 'Elevated', accent: 'border-l-amber-400', badge: 'bg-amber-100 text-amber-700' }, // prettier-ignore
  { band: PriorityBand.P3, label: 'Routine', accent: 'border-l-slate-400', badge: 'bg-slate-100 text-slate-600' }, // prettier-ignore
];

const BAND_BADGE = new Map(PRIORITY_TILES.map((tile) => [tile.band, tile.badge]));

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

/** Centered status message inside a region body (loading / empty / degraded). */
function RegionMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-[6rem] items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50/60 p-4 text-center">
      <p className="text-xs text-slate-500">{children}</p>
    </div>
  );
}

function shortId(reportId: string): string {
  return reportId.length > 8 ? `${reportId.slice(0, 8)}…` : reportId;
}

function formatReported(createdAt: string | null): string {
  if (!createdAt) return '—';
  const ms = Date.parse(createdAt);
  return Number.isNaN(ms) ? '—' : new Date(ms).toLocaleString();
}

/** One row of the priority queue. Renders only redacted, PII-free fields. */
function IncidentRow({ incident }: { incident: PublicReport }) {
  const band = bandOf(incident);
  const badge = (band && BAND_BADGE.get(band)) ?? 'bg-slate-100 text-slate-600';
  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50">
      <td className="whitespace-nowrap px-3 py-2">
        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${badge}`}>{band ?? '—'}</span>
        <span className="ml-2 tabular-nums text-xs text-slate-500">
          {incident.priorityScore != null ? incident.priorityScore.toFixed(1) : '—'}
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-slate-700">{incident.category ?? '—'}</td>
      <td className="px-3 py-2 text-xs text-slate-700">{incident.urgency ?? '—'}</td>
      <td className="px-3 py-2 text-xs text-slate-700">{incident.status}</td>
      <td className="px-3 py-2 text-xs text-slate-500">{incident.regionId ?? '—'}</td>
      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">
        {formatReported(incident.createdAt)}
      </td>
      <td className="px-3 py-2 font-mono text-xs text-slate-400">{shortId(incident.reportId)}</td>
    </tr>
  );
}

/** The priority-ordered incident table (design doc §2.4). */
function IncidentQueue({ incidents }: { incidents: PublicReport[] }) {
  if (incidents.length === 0) {
    return <RegionMessage>No incidents yet. New reports will appear here as they arrive.</RegionMessage>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-left">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            <th className="px-3 py-2">Priority</th>
            <th className="px-3 py-2">Category</th>
            <th className="px-3 py-2">Urgency</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Region</th>
            <th className="px-3 py-2">Reported</th>
            <th className="px-3 py-2">ID</th>
          </tr>
        </thead>
        <tbody>
          {sortByPriority(incidents).map((incident) => (
            <IncidentRow key={incident.reportId} incident={incident} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders the body of a data-driven region for each feed state. `idle` returns
 * `null` so the parent `Region` falls back to its shell placeholder.
 */
function feedBody(feed: IncidentFeedState, ready: (incidents: PublicReport[]) => ReactNode): ReactNode {
  switch (feed.status) {
    case 'idle':
      return null;
    case 'loading':
      return <RegionMessage>Loading incidents…</RegionMessage>;
    case 'unauthenticated':
      return (
        <RegionMessage>
          Sign in as a coordinator to view live incidents. Authentication lands with CRIS-7.
        </RegionMessage>
      );
    case 'error':
      return <RegionMessage>Couldn’t load incidents: {feed.message}</RegionMessage>;
    case 'ready':
      return ready(feed.incidents);
  }
}

/** Header pill summarizing the read connection (distinct from the CRIS-28 push). */
function ReadStatus({ feed }: { feed: IncidentFeedState }) {
  const map: Record<IncidentFeedState['status'], { dot: string; text: string }> = {
    idle: { dot: 'bg-slate-300', text: 'Not wired' },
    loading: { dot: 'bg-amber-400', text: 'Loading incidents…' },
    unauthenticated: { dot: 'bg-slate-300', text: 'Sign in to load incidents' },
    error: { dot: 'bg-red-400', text: 'Load failed' },
    ready: { dot: 'bg-emerald-500', text: `${feed.status === 'ready' ? feed.incidents.length : 0} incidents loaded` },
  };
  const { dot, text } = map[feed.status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-500">
      <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      {text}
    </span>
  );
}

export function CoordinatorDashboard({ onExit, feed = { status: 'idle' }, onRefresh }: CoordinatorDashboardProps) {
  const counts = feed.status === 'ready' ? countByBand(feed.incidents) : null;
  const unscored = feed.status === 'ready' ? countUnscored(feed.incidents) : 0;
  const categories = feed.status === 'ready' ? countByCategory(feed.incidents) : [];
  const isLive = feed.status !== 'idle';

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
          </div>
          <div className="flex items-center gap-3">
            {/* Read connection (one-shot list + refresh). Shown once wired. */}
            {isLive ? <ReadStatus feed={feed} /> : null}
            {/* Real-time PUSH indicator — wired by subscriptions (CRIS-28). */}
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-500"
              title="Live push updates arrive with CRIS-28 (AppSync subscriptions)"
            >
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-slate-300" />
              Live updates: not connected
            </span>
            {onRefresh ? (
              <button
                type="button"
                onClick={onRefresh}
                disabled={feed.status === 'loading'}
                className="rounded border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Refresh
              </button>
            ) : null}
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
        {/* Incident metrics strip (Fig 1). Counts are live once the feed is ready. */}
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
                {counts ? (
                  <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                    {counts[tile.band]}
                  </p>
                ) : (
                  <p className="mt-1 text-2xl font-bold tabular-nums text-slate-300" aria-hidden="true">
                    —
                  </p>
                )}
              </div>
            ))}
          </div>
          {feed.status === 'ready' && unscored > 0 ? (
            <p className="mt-2 text-xs text-slate-400">
              {unscored} awaiting AI classification (not yet scored).
            </p>
          ) : null}
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
            >
              {feedBody(feed, (incidents) => (
                <IncidentQueue incidents={incidents} />
              ))}
            </Region>
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
            >
              {feedBody(feed, (incidents) =>
                incidents.length === 0 ? (
                  <RegionMessage>No incidents yet.</RegionMessage>
                ) : (
                  <ul className="space-y-1.5">
                    {categories.map(({ category, count }) => (
                      <li key={category} className="flex items-center justify-between text-xs">
                        <span className="text-slate-600">{category}</span>
                        <span className="tabular-nums font-semibold text-slate-700">{count}</span>
                      </li>
                    ))}
                  </ul>
                ),
              )}
            </Region>
          </div>
        </div>
      </main>
    </div>
  );
}
