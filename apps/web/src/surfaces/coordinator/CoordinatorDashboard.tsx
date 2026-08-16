import { useState, type ReactNode } from 'react';
import {
  canActorTransition,
  Category,
  CATEGORY_MAX_POINTS,
  CORROBORATION_MAX_POINTS,
  PriorityBand,
  RECENCY_MAX_POINTS,
  ReportEventType,
  ReportStatus,
  STATUS_TRANSITIONS,
  URGENCY_MAX_POINTS,
  UserRole,
  type PublicReport,
  type ScoreBreakdown,
  type TriageEntities,
} from '@crisismap/shared';
import {
  applyFilters,
  bandOf,
  countByBand,
  countByCategory,
  countUnscored,
  EMPTY_FILTERS,
  filtersActive,
  regionOptions,
  sortByPriority,
  toggleValue,
  type CoordinatorIncident,
  type IncidentFeedState,
  type IncidentFilters,
  type IncidentTimelineState,
  type TimelineEvent,
} from './incidents';
import type { TransitionRequest, TransitionUiState } from './useReportTransition';
import type { AssignTeamRequest, AssignTeamUiState } from './useAssignTeam';
import type { TeamOption } from './useTeams';
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
 *   - Filters (category / status / region)        → CRIS-22 (interactive ✓)
 *   - Live map (Amazon Location + MapLibre)        → CRIS-13 (base map ✓)
 *   - Priority-ordered incident queue              → live here; filtered by CRIS-22
 *   - Incident detail (summary / score / timeline) → CRIS-23
 *   - Status transitions (verify/reject/resolve …) → CRIS-18 (wired here)
 *   - Guarded response actions (assign team)       → CRIS-32 (wired here); merge remains deferred
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
  /**
   * Notified whenever the selected incident changes (the report id, or `null`
   * when the selection is cleared). Selection stays *internal* view state; this
   * only lets the route wrapper drive the per-incident timeline read
   * (`useIncidentTimeline`) without making selection a controlled prop (CRIS-23).
   */
  onSelectIncident?: (reportId: string | null) => void;
  /**
   * Audit timeline for the currently-selected incident (CRIS-23). Injected by
   * the route wrapper (which owns `useIncidentTimeline`) so this component stays
   * presentational. Defaults to `idle` — the pre-wired shell shows no timeline.
   */
  timeline?: IncidentTimelineState;
  /**
   * Assign a response team to the selected incident (CRIS-32). Injected by the
   * route wrapper (which owns `useAssignTeam`) so this component stays
   * presentational. When omitted, the incident-detail panel shows no team
   * picker (the pre-wired shell).
   */
  onAssignTeam?: (request: AssignTeamRequest) => void;
  /** Lifecycle of the in-flight/last assignment, for inline feedback (CRIS-32). */
  assignment?: AssignTeamUiState;
  /** Response teams offered by the assignment picker (CRIS-32). */
  teams?: readonly TeamOption[];
  /**
   * The signed-in caller's real Cognito role (CRIS-24), used to compute which
   * status-transition buttons to offer — mirroring the server's
   * `TRANSITION_ROLES` for whichever role is actually signed in, not always
   * `COORDINATOR`. Defaults to `COORDINATOR` so the shell and its fixture-driven
   * tests (which render with no role prop) are unchanged; the live route
   * (`Router.tsx`) always passes the caller's actual `highestRole`.
   */
  callerRole?: UserRole;
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

/**
 * An interactive facet chip (CRIS-22). A toggle button — `aria-pressed` reflects
 * whether the value is part of the active filter — so the facets are operable by
 * keyboard and screen reader, not just decorative (design doc §2.4).
 */
function FilterChip({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
        active
          ? 'border-sky-500 bg-sky-500 text-white'
          : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
      }`}
    >
      {label}
    </button>
  );
}

/** A titled group of facet chips (Category / Status / Region). */
function FacetGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/**
 * The interactive filter facets (CRIS-22, design doc §2.4). Category and status
 * are the fixed shared enums; region is data-driven — only regions present in
 * the loaded feed are offered (`regions`), so the facet never lists a region
 * with zero incidents. Selection state and the narrowing itself are owned by the
 * parent (this stays presentational); "Clear filters" appears only while a facet
 * is active.
 */
function FilterPanel({
  filters,
  regions,
  onToggleCategory,
  onToggleStatus,
  onToggleRegion,
  onClear,
}: {
  filters: IncidentFilters;
  regions: readonly string[];
  onToggleCategory: (category: Category) => void;
  onToggleStatus: (status: ReportStatus) => void;
  onToggleRegion: (regionId: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-3">
      <FacetGroup label="Category">
        {CATEGORIES.map((category) => (
          <FilterChip
            key={category}
            label={category}
            active={filters.categories.includes(category)}
            onToggle={() => onToggleCategory(category)}
          />
        ))}
      </FacetGroup>
      <FacetGroup label="Status">
        {STATUSES.map((status) => (
          <FilterChip
            key={status}
            label={status}
            active={filters.statuses.includes(status)}
            onToggle={() => onToggleStatus(status)}
          />
        ))}
      </FacetGroup>
      {regions.length > 0 ? (
        <FacetGroup label="Region">
          {regions.map((region) => (
            <FilterChip
              key={region}
              label={region}
              active={filters.regionIds.includes(region)}
              onToggle={() => onToggleRegion(region)}
            />
          ))}
        </FacetGroup>
      ) : null}
      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="text-xs text-slate-400">
          Select facets to narrow the queue. Filtering is client-side over the loaded feed.
        </p>
        {filtersActive(filters) ? (
          <button
            type="button"
            onClick={onClear}
            className="whitespace-nowrap rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Clear filters
          </button>
        ) : null}
      </div>
    </div>
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
  totalCount,
  filtered,
  selectedReportId,
  onSelect,
}: {
  /** The rows to render — already narrowed by the active filters. */
  incidents: CoordinatorIncident[];
  /** Size of the unfiltered feed, for the "showing N of M" summary. */
  totalCount: number;
  /** Whether any facet is active (distinguishes the two empty states). */
  filtered: boolean;
  selectedReportId: string | null;
  onSelect: (reportId: string) => void;
}) {
  if (totalCount === 0) {
    return (
      <RegionMessage>No incidents yet. New reports will appear here as they arrive.</RegionMessage>
    );
  }
  if (incidents.length === 0) {
    // The feed has incidents, but the active filters hide all of them.
    return <RegionMessage>No incidents match the current filters.</RegionMessage>;
  }
  return (
    <div className="space-y-2">
      <p className="px-1 text-xs text-slate-400">
        {filtered ? `Showing ${incidents.length} of ${totalCount}` : `${totalCount} incidents`}
      </p>
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
 * The status transitions `role` may drive from `from` (CRIS-18, CRIS-24). The
 * structurally-legal moves come from `STATUS_TRANSITIONS`; `canActorTransition`
 * narrows them to that role's authority — mirroring the server's
 * `TRANSITION_ROLES` so the UI only offers moves the resolver will accept — but
 * the resolver remains the real gate (a `FORBIDDEN` still surfaces as an error).
 * SYSTEM-only moves (NEW→PROCESSING, classification) never appear here.
 */
function coordinatorTransitions(from: ReportStatus, role: UserRole): ReportStatus[] {
  return STATUS_TRANSITIONS[from].filter((to) => canActorTransition(role, from, to));
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/** A labelled section heading inside the incident-detail panel. */
function DetailLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
      {children}
    </p>
  );
}

/** A small read-only pill used for infrastructure/hazard entity chips. */
function EntityTag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
      {children}
    </span>
  );
}

/**
 * The classification snapshot — category, urgency, priority band + score, and
 * model confidence (design doc Fig 2). Confidence is the model's self-report in
 * [0, 1], shown as a percentage; it is context, never the priority itself (the
 * deterministic score is — see {@link ScoreBreakdownView}).
 */
function ClassificationMeta({ incident }: { incident: CoordinatorIncident }) {
  const band = bandOf(incident);
  const fields: { label: string; value: string }[] = [
    { label: 'Category', value: incident.category ?? '—' },
    { label: 'Urgency', value: incident.urgency ?? '—' },
    {
      label: 'Priority',
      value: incident.priorityScore != null ? `${band ?? '—'} · ${incident.priorityScore.toFixed(1)}` : '—', // prettier-ignore
    },
    {
      label: 'Confidence',
      value: incident.confidence != null ? `${Math.round(incident.confidence * 100)}%` : '—',
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
      {fields.map((field) => (
        <div key={field.label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
            {field.label}
          </dt>
          <dd className="text-sm text-slate-700">{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The additive score factors, each with the max points it can contribute. */
const SCORE_FACTORS: readonly { key: keyof ScoreBreakdown; label: string; max: number }[] = [
  { key: 'urgencyWeight', label: 'Urgency', max: URGENCY_MAX_POINTS },
  { key: 'categoryWeight', label: 'Category', max: CATEGORY_MAX_POINTS },
  { key: 'recencyWeight', label: 'Recency', max: RECENCY_MAX_POINTS },
  { key: 'corroborationWeight', label: 'Corroboration', max: CORROBORATION_MAX_POINTS },
];

/**
 * The "why this ranks here" panel (design guarantee: priority is deterministic
 * and *explainable*, §5.4.2). Renders each additive factor as a proportional bar
 * against the points it can contribute, so a coordinator can see whether a rank
 * is driven by urgency, category, recency, or corroboration. A non-zero manual
 * adjustment (a coordinator override) is shown separately since it may be
 * negative and is not bounded to [0, max] the same way.
 */
function ScoreBreakdownView({ breakdown }: { breakdown: ScoreBreakdown }) {
  return (
    <div>
      <DetailLabel>Why this priority</DetailLabel>
      <ul className="space-y-1.5">
        {SCORE_FACTORS.map((factor) => {
          const value = breakdown[factor.key] as number;
          const pct = clampPercent((value / factor.max) * 100);
          return (
            <li key={factor.key}>
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>{factor.label}</span>
                <span className="tabular-nums text-slate-500">+{value.toFixed(2)}</span>
              </div>
              <div
                className="mt-0.5 h-1.5 overflow-hidden rounded bg-slate-100"
                role="presentation"
              >
                <div className="h-full rounded bg-sky-400" style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
        {breakdown.manualAdjustment !== 0 ? (
          <li className="flex items-center justify-between text-xs text-slate-600">
            <span>Manual adjustment</span>
            <span className="tabular-nums text-slate-500">
              {breakdown.manualAdjustment > 0 ? '+' : ''}
              {breakdown.manualAdjustment.toFixed(2)}
            </span>
          </li>
        ) : null}
      </ul>
      {breakdown.notes ? <p className="mt-1.5 text-xs text-slate-400">{breakdown.notes}</p> : null}
    </div>
  );
}

/**
 * PII-free entities the Triage Agent extracted (§2.2, design doc Fig 2 & Fig 4):
 * estimated people affected, and the specific infrastructure / hazards named in
 * the report. Renders nothing when no entities were extracted.
 */
function EntitiesView({ entities }: { entities: TriageEntities }) {
  const hasAny =
    entities.peopleAffected != null ||
    entities.infrastructure.length > 0 ||
    entities.hazards.length > 0;
  if (!hasAny) return null;
  return (
    <div className="space-y-2">
      <DetailLabel>Extracted details</DetailLabel>
      {entities.peopleAffected != null ? (
        <p className="text-xs text-slate-600">
          <span className="font-semibold text-slate-700">{entities.peopleAffected}</span> people
          affected
        </p>
      ) : null}
      {entities.infrastructure.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-400">Infrastructure:</span>
          {entities.infrastructure.map((item) => (
            <EntityTag key={item}>{item}</EntityTag>
          ))}
        </div>
      ) : null}
      {entities.hazards.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-400">Hazards:</span>
          {entities.hazards.map((item) => (
            <EntityTag key={item}>{item}</EntityTag>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Human label for one audit event (design doc §5.1 event types). */
function timelineEventLabel(event: TimelineEvent): string {
  switch (event.type) {
    case ReportEventType.SUBMITTED:
      return 'Report submitted';
    case ReportEventType.CLASSIFIED:
      return 'AI classified';
    case ReportEventType.PRIORITY_SCORED:
      return 'Priority scored';
    case ReportEventType.VERIFICATION_RECORDED:
      return 'Verification recorded';
    case ReportEventType.ASSIGNED:
      return 'Team assigned';
    case ReportEventType.DUPLICATE_LINKED:
      return 'Linked as duplicate';
    case ReportEventType.ALERT_DISPATCHED:
      return 'Alert dispatched';
    case ReportEventType.STATUS_CHANGED:
      return event.fromStatus && event.toStatus
        ? `${event.fromStatus} → ${event.toStatus}`
        : 'Status changed';
    default:
      return event.type;
  }
}

/** Who drove an event: `System` for pipeline events, else the actor's role. */
function timelineActor(event: TimelineEvent): string {
  if (event.isSystem) return 'System';
  return event.actorRole ?? 'Unknown';
}

/**
 * The selected incident's audit timeline (CRIS-23) — its own `ReportEvent` log,
 * newest-first. Distinct from the dashboard-wide "Recent activity" stream
 * (CRIS-28). Renders one branch per feed state; the injected `timeline` defaults
 * to `idle` in the shell, where no read has been wired.
 */
function TimelineView({ timeline }: { timeline: IncidentTimelineState }) {
  return (
    <div>
      <DetailLabel>Timeline</DetailLabel>
      {timeline.status === 'idle' ? (
        <p className="text-xs text-slate-400">No timeline loaded.</p>
      ) : null}
      {timeline.status === 'loading' ? (
        <p className="text-xs text-slate-500">Loading timeline…</p>
      ) : null}
      {timeline.status === 'error' ? (
        <p className="text-xs text-red-600" role="alert">
          {timeline.message}
        </p>
      ) : null}
      {timeline.status === 'ready' ? (
        timeline.events.length === 0 ? (
          <p className="text-xs text-slate-400">No audit events recorded yet.</p>
        ) : (
          <ol className="space-y-2">
            {timeline.events.map((event) => (
              <li key={event.eventId} className="border-l-2 border-slate-200 pl-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-slate-700">
                    {timelineEventLabel(event)}
                  </span>
                  <span className="whitespace-nowrap text-xs text-slate-400">
                    {formatReported(event.createdAt)}
                  </span>
                </div>
                <p className="text-xs text-slate-400">{timelineActor(event)}</p>
                {event.note ? (
                  <p className="mt-0.5 text-xs text-slate-500">“{event.note}”</p>
                ) : null}
              </li>
            ))}
          </ol>
        )
      ) : null}
    </div>
  );
}

/**
 * The CRIS-18 status-transition controls for the selected incident. Split out of
 * the read-only detail so the panel can render the incident's full picture
 * (summary, score, entities, timeline) independently of whether a transition
 * handler is wired.
 */
function TransitionControls({
  incident,
  callerRole,
  onTransition,
  transition,
}: {
  incident: CoordinatorIncident;
  callerRole: UserRole;
  onTransition: (request: TransitionRequest) => void;
  transition: TransitionUiState;
}) {
  const [note, setNote] = useState('');
  const from = incident.status;
  const moves = coordinatorTransitions(from, callerRole);
  const isSubmitting =
    transition.status === 'submitting' && transition.reportId === incident.reportId;
  const showError = transition.status === 'error' && transition.reportId === incident.reportId;
  const showSuccess = transition.status === 'success' && transition.reportId === incident.reportId;

  return (
    <div className="space-y-3 border-t border-slate-100 pt-3">
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
 * The shell's disabled action affordances, shown when no transition handler is
 * wired (the presentational default). Live actions arrive with the injected
 * `onTransition` (CRIS-18) / `onAssignTeam` (CRIS-32); merge remains deferred.
 */
function DisabledActions() {
  return (
    <div className="space-y-2 border-t border-slate-100 pt-3">
      <div className="flex flex-wrap gap-2">
        {['Verify', 'Reject', 'Assign team', 'Resolve'].map((action) => (
          <button
            key={action}
            type="button"
            disabled
            className="cursor-not-allowed rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-400"
            title="Select an incident to enable status and assignment actions (CRIS-18/CRIS-32)"
          >
            {action}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-400">Merging duplicate reports is not yet built.</p>
    </div>
  );
}

/**
 * The CRIS-32 team-assignment controls for the selected incident. Independent
 * of `TransitionControls`/`DisabledActions` — a report can be assigned a team
 * regardless of which status actions are currently legal — so it renders
 * whenever `onAssignTeam` is wired, alongside whichever of those two rendered.
 */
function AssignTeamControls({
  incident,
  teams,
  onAssignTeam,
  assignment,
}: {
  incident: CoordinatorIncident;
  teams: readonly TeamOption[];
  onAssignTeam: (request: AssignTeamRequest) => void;
  assignment: AssignTeamUiState;
}) {
  const [teamId, setTeamId] = useState(incident.assignedTeamId ?? '');
  const isSubmitting =
    assignment.status === 'submitting' && assignment.reportId === incident.reportId;
  const showError = assignment.status === 'error' && assignment.reportId === incident.reportId;
  const showSuccess = assignment.status === 'success' && assignment.reportId === incident.reportId;
  const currentTeamName = teams.find((team) => team.id === incident.assignedTeamId)?.name;

  return (
    <div className="space-y-2 border-t border-slate-100 pt-3">
      <DetailLabel>Team assignment</DetailLabel>
      {incident.assignedTeamId ? (
        <p className="text-xs text-slate-500">
          Currently assigned:{' '}
          <span className="font-medium text-slate-700">
            {currentTeamName ?? incident.assignedTeamId}
          </span>
        </p>
      ) : (
        <p className="text-xs text-slate-400">No team assigned yet.</p>
      )}
      {teams.length > 0 ? (
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="assign-team-select">
            Team
          </label>
          <select
            id="assign-team-select"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 focus:border-sky-400 focus:outline-none"
          >
            <option value="">Select a team…</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!teamId || isSubmitting}
            onClick={() =>
              onAssignTeam({
                reportId: incident.reportId,
                teamId,
                expectedVersion: incident.version,
              })
            }
            className="whitespace-nowrap rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Assign
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-400">No teams available.</p>
      )}
      {isSubmitting ? <p className="text-xs text-slate-500">Assigning…</p> : null}
      {showSuccess ? (
        <p className="text-xs text-emerald-600" role="status">
          Team assigned.
        </p>
      ) : null}
      {showError ? (
        <p className="text-xs text-red-600" role="alert">
          {assignment.code === 'CONFLICT'
            ? 'This report changed since you loaded it. Refresh and try again.'
            : assignment.message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Incident-detail interface (CRIS-23, design doc Fig 2). The full picture for
 * the selected incident: classification snapshot, AI summary, extracted
 * entities, the explainable score breakdown, and the per-incident audit
 * timeline — all PII-free. The CRIS-18 transition controls render below when an
 * `onTransition` handler is wired; otherwise the shell's disabled placeholders
 * do. The CRIS-32 team-assignment controls render independently when
 * `onAssignTeam` is wired. Merging duplicate reports remains deferred.
 */
function IncidentDetail({
  incident,
  timeline,
  callerRole,
  onTransition,
  transition,
  onAssignTeam,
  assignment,
  teams,
}: {
  incident: CoordinatorIncident;
  timeline: IncidentTimelineState;
  callerRole: UserRole;
  onTransition?: (request: TransitionRequest) => void;
  transition: TransitionUiState;
  onAssignTeam?: (request: AssignTeamRequest) => void;
  assignment: AssignTeamUiState;
  teams: readonly TeamOption[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-slate-500">{incident.reportId}</span>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
          {incident.status}
        </span>
      </div>

      <ClassificationMeta incident={incident} />

      {incident.summary ? (
        <p className="text-sm text-slate-600">{incident.summary}</p>
      ) : (
        <p className="text-xs text-slate-400">No AI summary yet.</p>
      )}

      {incident.entities ? <EntitiesView entities={incident.entities} /> : null}

      {incident.scoreBreakdown ? <ScoreBreakdownView breakdown={incident.scoreBreakdown} /> : null}

      <TimelineView timeline={timeline} />

      {onTransition ? (
        <TransitionControls
          incident={incident}
          callerRole={callerRole}
          onTransition={onTransition}
          transition={transition}
        />
      ) : (
        <DisabledActions />
      )}

      {onAssignTeam ? (
        <AssignTeamControls
          incident={incident}
          teams={teams}
          onAssignTeam={onAssignTeam}
          assignment={assignment}
        />
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
  onSelectIncident,
  timeline = { status: 'idle' },
  onAssignTeam,
  assignment = { status: 'idle' },
  teams = [],
  callerRole = UserRole.COORDINATOR,
}: CoordinatorDashboardProps) {
  const counts = feed.status === 'ready' ? countByBand(feed.incidents) : null;
  const unscored = feed.status === 'ready' ? countUnscored(feed.incidents) : 0;
  const categories = feed.status === 'ready' ? countByCategory(feed.incidents) : [];
  const isLive = feed.status !== 'idle';

  // Which incident the detail panel + CRIS-18 transition controls act on. Pure
  // view state (not a data source), so it lives in the presentational component.
  // Selecting also notifies the parent (`onSelectIncident`) so it can load the
  // incident's timeline (CRIS-23) without selection becoming a controlled prop.
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const incidents = feed.status === 'ready' ? feed.incidents : [];
  const selectedIncident = incidents.find((i) => i.reportId === selectedReportId) ?? null;
  const selectIncident = (reportId: string) => {
    setSelectedReportId(reportId);
    onSelectIncident?.(reportId);
  };

  // CRIS-22 queue filters. Also pure view state — the narrowing happens
  // client-side over the already-loaded feed; the read path is unchanged. Region
  // options are derived from what's actually loaded so the facet never offers an
  // empty region.
  const [filters, setFilters] = useState<IncidentFilters>(EMPTY_FILTERS);
  const regions = regionOptions(incidents);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      {/* Command bar */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold tracking-tight">Coordinator dashboard</h1>
            <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">
              {callerRole}
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

        {/* Filters (Fig 11). Interactive faceted narrowing of the queue (CRIS-22). */}
        <Region
          title="Filters"
          ticket="CRIS-22"
          hint="Filter incidents by category, status, and region"
          className="mb-6"
        >
          <FilterPanel
            filters={filters}
            regions={regions}
            onToggleCategory={(category) =>
              setFilters((f) => ({ ...f, categories: toggleValue(f.categories, category) }))
            }
            onToggleStatus={(status) =>
              setFilters((f) => ({ ...f, statuses: toggleValue(f.statuses, status) }))
            }
            onToggleRegion={(regionId) =>
              setFilters((f) => ({ ...f, regionIds: toggleValue(f.regionIds, regionId) }))
            }
            onClear={() => setFilters(EMPTY_FILTERS)}
          />
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
                  incidents={applyFilters(rows, filters)}
                  totalCount={rows.length}
                  filtered={filtersActive(filters)}
                  selectedReportId={selectedReportId}
                  onSelect={selectIncident}
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
              {selectedIncident ? (
                // The full incident-detail interface (CRIS-23). CRIS-18 status
                // transitions render within it when `onTransition` is wired;
                // CRIS-32 team assignment renders when `onAssignTeam` is wired.
                // Merging duplicate reports remains deferred.
                <IncidentDetail
                  incident={selectedIncident}
                  timeline={timeline}
                  callerRole={callerRole}
                  onTransition={onTransition}
                  transition={transition}
                  onAssignTeam={onAssignTeam}
                  assignment={assignment}
                  teams={teams}
                />
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-slate-500">
                    {isLive ? 'Select an incident to view its detail.' : 'No incident selected.'}
                  </p>
                  <p className="text-xs text-slate-400">
                    Selecting a row in the queue opens its classification, AI summary, score
                    breakdown, extracted entities, and audit timeline here.
                  </p>
                  {/* Placeholder actions until an incident is selected. Live
                      status transitions (Verify / Reject / Resolve …) and team
                      assignment render in the detail panel once a row is
                      selected (CRIS-18/CRIS-32); merge remains deferred. */}
                  <DisabledActions />
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
