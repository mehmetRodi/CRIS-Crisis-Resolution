import { Category, ReportStatus } from '@crisismap/shared';
import { SlidersHorizontal, X } from 'lucide-react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  SheetContent,
} from '../../components/ui/dialog';
import { cn } from '../../lib/cn';
import { categoryMeta, statusMeta } from '../../lib/domain-display';
import {
  EMPTY_FILTERS,
  filtersActive,
  toggleValue,
  type IncidentFilters,
} from '../coordinator/incidents';

const CATEGORIES = Object.values(Category);
const STATUSES = Object.values(ReportStatus);

/**
 * Queue facets (CRIS-22 → CRIS-54).
 *
 * Moved into a sheet rather than sitting permanently above the queue. In a
 * map-first layout the left column is the incident list; a three-row block of
 * ~22 always-visible chips pushed the actual incidents below the fold, which is
 * the opposite of what a triage surface should show first. The trigger carries a
 * count so an active filter is never invisible — a coordinator seeing an empty
 * queue must be able to tell "nothing is happening" from "you filtered it all
 * out" without opening anything.
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
      className={cn(
        'rounded-sm border px-2 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-accent bg-accent text-fg-on-solid'
          : 'border-border bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      {label}
    </button>
  );
}

function FacetGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{label}</h3>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/** How many individual facet values are selected, across all groups. */
function activeFilterCount(filters: IncidentFilters): number {
  return filters.categories.length + filters.statuses.length + filters.regionIds.length;
}

export function FilterSheet({
  filters,
  regions,
  onChange,
}: {
  filters: IncidentFilters;
  /** Only regions present in the loaded feed, so no facet yields zero results. */
  regions: readonly string[];
  onChange: (filters: IncidentFilters) => void;
}) {
  const count = activeFilterCount(filters);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" className="shrink-0">
          <SlidersHorizontal aria-hidden="true" />
          Filters
          {count > 0 ? (
            <Badge variant="accent" size="sm" aria-label={`${count} filters active`}>
              {count}
            </Badge>
          ) : null}
        </Button>
      </DialogTrigger>

      <SheetContent side="right" aria-describedby="filter-sheet-description">
        <DialogHeader>
          <DialogTitle>Filter incidents</DialogTitle>
          <DialogDescription id="filter-sheet-description">
            Narrows the incidents already loaded. Filtering does not re-query the server.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <FacetGroup label="Category">
            {CATEGORIES.map((category) => (
              <FilterChip
                key={category}
                label={categoryMeta(category).label}
                active={filters.categories.includes(category)}
                onToggle={() =>
                  onChange({ ...filters, categories: toggleValue(filters.categories, category) })
                }
              />
            ))}
          </FacetGroup>

          <FacetGroup label="Status">
            {STATUSES.map((status) => (
              <FilterChip
                key={status}
                label={statusMeta(status).label}
                active={filters.statuses.includes(status)}
                onToggle={() =>
                  onChange({ ...filters, statuses: toggleValue(filters.statuses, status) })
                }
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
                  onToggle={() =>
                    onChange({ ...filters, regionIds: toggleValue(filters.regionIds, region) })
                  }
                />
              ))}
            </FacetGroup>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p className="text-xs text-fg-muted">
            {count === 0 ? 'No filters applied' : `${count} selected`}
          </p>
          <Button
            variant="ghost"
            size="sm"
            disabled={!filtersActive(filters)}
            onClick={() => onChange(EMPTY_FILTERS)}
          >
            <X aria-hidden="true" />
            Clear all
          </Button>
        </div>
      </SheetContent>
    </Dialog>
  );
}
