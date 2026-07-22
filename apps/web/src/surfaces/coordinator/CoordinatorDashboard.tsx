import { useState, type ReactNode } from 'react';
import {
  canActorTransition,
  Category,
  PriorityBand,
  ReportStatus,
  STATUS_TRANSITIONS,
  UserRole,
  type PublicReport,
} from '@crisismap/shared';
import {
  bandOf,
  countByBand,
  countByCategory,
  countUnscored,
  sortByPriority,
  type CoordinatorIncident,
  type IncidentFeedState,
} from './incidents';
import type { TransitionRequest, TransitionUiState } from './useReportTransition';
import { IncidentMap } from '../map/IncidentMap';

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
 * and the queue shows a sign-in prompt rather than erroring.
 *
 * Region → owning ticket (Fig 11 interaction map):
 *   - Filters (category / status / region)        → CRIS-22 (facets read-only)
 *   - Live map (Amazon Location + MapLibre)        → CRIS-13 (base map ✓)
 *   - Priority-ordered incident queue              → live here; filters CRIS-22
 *   - Incident detail (summary / score / timeline) → CRIS-23
 *   - Status transitions (verify/reject/resolve …) → CRIS-18 (wired here)
 *   - Guarded response actions (assign team, merge) → CRIS-32
 *   - Recent activity (audit timeline)             → CRIS-28
 *   - Live-update push (subscriptions)             → CRIS-28
 *
 * This is a one-shot read with a manual refresh, NOT a live subscription — the
 * "live updates" indicator stays disconnected until CRIS-28. Authentication
 * exists, but coordinator-group enforcement at the route boundary is deferred.
 */

interface CoordinatorDashboardProps {
  /** Navigate back to the scaffold overview. Router-agnostic: the route wrapper
   * wires this to the router (ADR-0022) so the component stays presentational. */
  onExit: () => void;
  /** Incident feed. Defaults to `idle` (the pre-wired shell). */
  feed?: IncidentFeedState;
  /** Re-run the read. Rendered as a header button when the feed is live. */
  onRefresh?: () => void;
  /**
   * Apply a status transition for the selected incident (CRIS-18). Injected by
   * the route wrapper (which owns `useReportTransition`) so this component stays
   * presentational. When omitted, the incident-detail panel keeps its disabled
   * placeholder actions (the pre-wired shell).
   */
  onTransition?: (request: TransitionRequest) => void;
  /** Lifecycle of the in-flight/last transition, for inline feedback (CRIS-18). */
  transition?: TransitionUiState;
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
function IncidentRow({
  incident,
  selected,
  onSelect,
}: {
  incident: PublicReport;
  selected: boolean;
  onSelect: () => void;
}) {
  const band = bandOf(incident);
  const badge = (band && BAND_BADGE.get(band)) ?? 'bg-slate-100 text-slate-600';
  return (
    <tr
      // Selecting a row opens it in the incident-detail panel, where CRIS-18
      // status transitions are applied. Full row-selection UX (multi-select,
      // detail view) is CRIS-22/23; this is the minimal selection the transition
      // wiring needs. Keyboard-operable for accessibility (CRIS-27).
      aria-selected={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`cursor-pointer border-t border-slate-100 ${
        selected ? 'bg-sky-50 ring-1 ring-inset ring-sky-300' : 'hover:bg-slate-50'
      }`}
    >
      <td className="whitespace-nowrap px-3 py-2">
        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${badge}`}>
          {band ?? '—'}
        </span>
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
function IncidentQueue({
  incidents,
  selectedReportId,
  onSelect,
}: {
  incidents: CoordinatorIncident[];
  selectedReportId: string | null;
  onSelect: (reportId: string) => void;
}) {
  if (incidents.length === 0) {
    return (
      <RegionMessage>No incidents yet. New reports will appear here as they arrive.</RegionMessage>
    );
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
            <IncidentRow
              key={incident.reportId}
              incident={incident}
              selected={incident.reportId === selectedReportId}
              onSelect={() => onSelect(incident.reportId)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Human label for a `from → to` status move shown on the transition button. */
function transitionLabel(from: ReportStatus, to: ReportStatus): string {
  switch (to) {
    case ReportStatus.VERIFIED:
      return 'Verify';
    case ReportStatus.REJECTED:
      return 'Reject';
    case ReportStatus.NEEDS_VERIFICATION:
      return 'Send to verification';
    case ReportStatus.RESOLVED:
      return 'Resolve';
    case ReportStatus.IN_PROGRESS:
      return from === ReportStatus.RESOLVED ? 'Reopen' : 'Start response';
    default:
      return `→ ${to}`;
  }
}

/**
 * The status transitions a coordinator may drive from `from` (CRIS-18). The
 * structurally-legal moves come from `STATUS_TRANSITIONS`; `canActorTransition`
 * narrows them to the coordinator's authority. This mirrors the server's
 * `TRANSITION_ROLES` so the UI only offers moves the resolver will accept — but
 * the resolver remains the real gate (a `FORBIDDEN` still surfaces as an error).
 * SYSTEM-only moves (NEW→PROCESSING, classification) never appear here.
 */
function coordinatorTransitions(from: ReportStatus): ReportStatus[] {
  return STATUS_TRANSITIONS[from].filter((to) =>
    canActorTransition(UserRole.COORDINATOR, from, to),
  );
}

/**
 * Incident-detail panel with the CRIS-18 status-transition controls. Presented
 * for the selected incident; the richer detail (AI summary, score breakdown,
 * timeline) is CRIS-23, and assignment/merge actions are CRIS-32.
 */
function IncidentDetail({
  incident,
  onTransition,
  transition,
}: {
  incident: CoordinatorIncident;
  onTransition: (request: TransitionRequest) => void;
  transition: TransitionUiState;
}) {
  const [note, setNote] = useState('');
  const from = incident.status;
  const moves = coordinatorTransitions(from);
  const isSubmitting =
    transition.status === 'submitting' && transition.reportId === incident.reportId;
  const showError = transition.status === 'error' && transition.reportId === incident.reportId;
  const showSuccess =
    transition.status === 'success' && transition.reportId === incident.reportId;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-slate-500">{incident.reportId}</span>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
          {from}
        </span>
      </div>

      {incident.summary ? (
        <p className="text-sm text-slate-600">{incident.summary}</p>
      ) : (
        <p className="text-xs text-slate-400">
          No AI summary yet. Summary, score breakdown, and timeline land in CRIS-23.
        </p>
      )}

      {moves.length > 0 ? (
        <>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Note (optional)
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Reason recorded on the audit trail"
              className="w-full rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 focus:border-sky-400 focus:outline-none"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {moves.map((to) => (
              <button
                key={to}
                type="button"
                disabled={isSubmitting}
                onClick={() =>
                  onTransition({
                    reportId: incident.reportId,
                    toStatus: to,
                    expectedVersion: incident.version,
                    note: note.trim() ? note.trim() : undefined,
                  })
                }
                className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {transitionLabel(from, to)}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="text-xs text-slate-400">
          No status actions available from <span className="font-semibold">{from}</span>.
        </p>
      )}

      {isSubmitting ? <p className="text-xs text-slate-500">Applying…</p> : null}
      {showSuccess ? (
        <p className="text-xs text-emerald-600" role="status">
          Updated to {transition.toStatus}.
        </p>
      ) : null}
      {showError ? (
        <p className="text-xs text-red-600" role="alert">
          {transition.code === 'CONFLICT'
            ? 'This report changed since you loaded it. Refresh and try again.'
            : transition.message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Renders the body of a data-driven region for each feed state. `idle` returns
 * `null` so the parent `Region` falls back to its shell placeholder.
 */
function feedBody(
  feed: IncidentFeedState,
  ready: (incidents: CoordinatorIncident[]) => ReactNode,
): ReactNode {
  switch (feed.status) {
    case 'idle':
      return null;
    case 'loading':
      return <RegionMessage>Loading incidents…</RegionMessage>;
    case 'unauthenticated':
      return (
        <RegionMessage>
          Sign in as a coordinator to view incidents. Route-level role enforcement is not wired yet.
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
    ready: {
      dot: 'bg-emerald-500',
      text: `${feed.status === 'ready' ? feed.incidents.length : 0} incidents loaded`,
    },
  };
  const { dot, text } = map[feed.status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-500">
      <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      {text}
    </span>
  );
}

export function CoordinatorDashboard({
  onExit,
  feed = { status: 'idle' },
  onRefresh,
  onTransition,
  transition = { status: 'idle' },
}: CoordinatorDashboardProps) {
  const counts = feed.status === 'ready' ? countByBand(feed.incidents) : null;
  const unscored = feed.status === 'ready' ? countUnscored(feed.incidents) : 0;
  const categories = feed.status === 'ready' ? countByCategory(feed.incidents) : [];
  const isLive = feed.status !== 'idle';

  // Which incident the detail panel + CRIS-18 transition controls act on. Pure
  // view state (not a data source), so it lives in the presentational component.
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const incidents = feed.status === 'ready' ? feed.incidents : [];
  const selectedIncident = incidents.find((i) => i.reportId === selectedReportId) ?? null;

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
                  <p
                    className="mt-1 text-2xl font-bold tabular-nums text-slate-300"
                    aria-hidden="true"
                  >
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
            >
              {/* Base map only (CRIS-13). Category-coloured incident markers and
                  viewport-driven fetching land with CRIS-22. */}
              <IncidentMap className="h-80 w-full overflow-hidden rounded-md border border-slate-200" />
            </Region>
            <Region
              title="Priority incident queue"
              ticket="CRIS-22"
              hint="De-duplicated, priority-ordered incident table with row selection"
              className="min-h-[16rem]"
            >
              {feedBody(feed, (rows) => (
                <IncidentQueue
                  incidents={rows}
                  selectedReportId={selectedReportId}
                  onSelect={setSelectedReportId}
                />
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
              {selectedIncident && onTransition ? (
                // CRIS-18: status transitions for the selected incident. The
                // richer detail (score breakdown, timeline) is CRIS-23; assign/
                // merge actions are CRIS-32.
                <IncidentDetail
                  incident={selectedIncident}
                  onTransition={onTransition}
                  transition={transition}
                />
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-slate-500">
                    {isLive ? 'Select an incident to view actions.' : 'No incident selected.'}
                  </p>
                  <p className="text-xs text-slate-400">
                    Selecting a row in the queue opens summary, score breakdown, and timeline here
                    (CRIS-23).
                  </p>
                  {/* Placeholder actions until an incident is selected. Live
                      status transitions (Verify / Reject / Resolve …) are wired
                      in the panel above once a row is selected (CRIS-18);
                      assignment / merge remain CRIS-32. */}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {['Verify', 'Reject', 'Assign team', 'Resolve'].map((action) => (
                      <button
                        key={action}
                        type="button"
                        disabled
                        className="cursor-not-allowed rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-400"
                        title="Select an incident to enable status actions (CRIS-18); assignment is CRIS-32"
                      >
                        {action}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400">
                    Assignment and merge actions are built in CRIS-32.
                  </p>
                </div>
              )}
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
