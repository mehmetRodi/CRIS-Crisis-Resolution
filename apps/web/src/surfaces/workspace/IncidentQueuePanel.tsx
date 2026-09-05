import { PriorityBand } from '@crisismap/shared';
import { Inbox, Search, TriangleAlert } from 'lucide-react';

import { EmptyState } from '../../components/domain/EmptyState';
import { MetricTile } from '../../components/domain/MetricTile';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import { cn } from '../../lib/cn';
import { PRIORITY_META } from '../../lib/domain-display';
import { pluralize } from '../../lib/format';
import {
  applyFilters,
  countByBand,
  countUnscored,
  filtersActive,
  searchIncidents,
  sortIncidents,
  toggleValue,
  type CoordinatorIncident,
  type IncidentFeedState,
  type IncidentFilters,
  type IncidentSort,
} from '../coordinator/incidents';
import { FilterSheet } from './FilterSheet';
import { IncidentRow } from './IncidentRow';

const BANDS = [PriorityBand.P0, PriorityBand.P1, PriorityBand.P2, PriorityBand.P3] as const;

/**
 * The priority queue (CRIS-22 → CRIS-54).
 *
 * The keyboard-operable twin of the map: same incidents, same selection, but
 * fully navigable. That relationship is why it is a permanent column rather
 * than a panel you open — a map-first product whose only accessible view is
 * hidden behind a toggle is not accessible.
 *
 * The band tiles double as filters. A coordinator's most common action is
 * "show me only the criticals", and making the number they are already staring
 * at the control for it removes a trip through the filter sheet entirely.
 */
export function IncidentQueuePanel({
  feed,
  filters,
  onFiltersChange,
  query,
  onQueryChange,
  sort,
  onSortChange,
  regions,
  selectedId,
  onSelect,
  className,
}: {
  feed: IncidentFeedState;
  filters: IncidentFilters;
  onFiltersChange: (filters: IncidentFilters) => void;
  query: string;
  onQueryChange: (query: string) => void;
  sort: IncidentSort;
  onSortChange: (sort: IncidentSort) => void;
  regions: readonly string[];
  selectedId: string | null;
  onSelect: (reportId: string) => void;
  className?: string;
}) {
  const incidents: CoordinatorIncident[] = feed.status === 'ready' ? feed.incidents : [];
  const counts = feed.status === 'ready' ? countByBand(incidents) : null;
  const unscored = feed.status === 'ready' ? countUnscored(incidents) : 0;

  // Facets first, then free text: the facets describe the working set, and the
  // search narrows within it. The reverse order would make the result count
  // shown against the facets meaningless.
  const visible = sortIncidents(searchIncidents(applyFilters(incidents, filters), query), sort);
  const narrowed = filtersActive(filters) || query.trim().length > 0;

  return (
    <section
      aria-labelledby="incident-queue-heading"
      className={cn('flex min-h-0 flex-col bg-surface', className)}
    >
      <h2 id="incident-queue-heading" className="sr-only">
        Priority incident queue
      </h2>

      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 space-y-3 border-b border-border/80 bg-surface/60 p-3 backdrop-blur-xs">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search incidents…"
              aria-label="Search incidents by summary, category, region, or ID"
              className="pl-8 text-xs h-9 rounded-lg border-border/80 bg-surface/90 shadow-2xs focus:border-accent"
            />
          </div>
          <FilterSheet filters={filters} regions={regions} onChange={onFiltersChange} />
        </div>

        {/* Band tiles. Each is a toggle for its own band, so the counts are also
            the fastest route to "only show me these". */}
        <div className="grid grid-cols-4 gap-1.5">
          {BANDS.map((band) => (
            <MetricTile
              key={band}
              label={band}
              count={counts ? counts[band] : null}
              accent={PRIORITY_META[band].solid}
              emptyLabel="count unavailable"
              selected={filters.priorityBands?.includes(band) ?? false}
              onClick={() =>
                onFiltersChange({
                  ...filters,
                  priorityBands: toggleValue(filters.priorityBands ?? [], band),
                })
              }
              className="px-2 py-1.5 pl-3"
            />
          ))}
        </div>

        {unscored > 0 ? (
          <div className="flex items-center gap-2 rounded-lg bg-warning/10 px-2.5 py-1.5 border border-warning/20">
            <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0 text-warning" />
            <p className="text-xs font-medium text-fg-muted">
              <span className="font-bold text-fg">{unscored}</span> {pluralize(unscored, 'report')} awaiting classification.
            </p>
          </div>
        ) : null}
      </div>

      {/* ── Result summary ───────────────────────────────────────────────── */}
      {feed.status === 'ready' ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-surface-sunken/40 px-3 py-2">
          <p className="text-xs font-medium text-fg-muted" aria-live="polite">
            {narrowed
              ? `${visible.length} of ${incidents.length} shown`
              : pluralize(incidents.length, 'incident')}
          </p>
          <div className="flex items-center gap-1 rounded-lg bg-surface-sunken p-0.5 border border-border/50" role="group" aria-label="Sort incidents">
            {(
              [
                ['priority', 'Priority'],
                ['recent', 'Newest'],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                variant="ghost"
                size="sm"
                aria-pressed={sort === value}
                onClick={() => onSortChange(value)}
                className={cn(
                  'h-6 px-2 text-[11px] font-semibold rounded-md transition-all',
                  sort === value
                    ? 'bg-surface text-fg shadow-2xs font-bold'
                    : 'text-fg-muted hover:text-fg',
                )}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── List ─────────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {feed.status === 'loading' ? (
          <div className="space-y-2 p-3">
            {/* The live region carries the state; the skeletons are decoration
                and are hidden from assistive tech by `Skeleton` itself. */}
            <p role="status" className="sr-only">
              Loading incidents.
            </p>
            {[0, 1, 2, 3, 4].map((index) => (
              <Skeleton key={index} className="h-20 w-full" />
            ))}
          </div>
        ) : null}

        {feed.status === 'idle' ? (
          <EmptyState
            icon={Inbox}
            title="No incident feed connected"
            description="Sign in with an operational role to load live incidents."
            className="m-3"
          />
        ) : null}

        {feed.status === 'unauthenticated' ? (
          <EmptyState
            icon={Inbox}
            title="Sign in to load incidents"
            description="The incident feed is available to responders, coordinators, and administrators."
            className="m-3"
          />
        ) : null}

        {feed.status === 'error' ? (
          <EmptyState
            tone="error"
            icon={TriangleAlert}
            title="Couldn't load incidents"
            description={feed.message}
            className="m-3"
          />
        ) : null}

        {feed.status === 'ready' ? (
          incidents.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No incidents yet"
              description="New reports appear here the moment they are submitted."
              className="m-3"
            />
          ) : visible.length === 0 ? (
            // Distinct from "no incidents": the feed HAS data and the user's own
            // narrowing is hiding it. Conflating the two would let a coordinator
            // believe a region is quiet when they simply left a filter on.
            <EmptyState
              icon={Search}
              title="No incidents match"
              description="Every loaded incident is hidden by the current search or filters."
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    onQueryChange('');
                    onFiltersChange({
                      categories: [],
                      statuses: [],
                      regionIds: [],
                      priorityBands: [],
                    });
                  }}
                >
                  Clear search and filters
                </Button>
              }
              className="m-3"
            />
          ) : (
            <ul className="divide-y divide-border">
              {visible.map((incident) => (
                <IncidentRow
                  key={incident.reportId}
                  incident={incident}
                  selected={incident.reportId === selectedId}
                  onSelect={() => onSelect(incident.reportId)}
                />
              ))}
            </ul>
          )
        ) : null}
      </div>
    </section>
  );
}
