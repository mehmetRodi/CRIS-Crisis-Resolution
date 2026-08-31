import { useState } from 'react';
import type { UserRole } from '@crisismap/shared';
import { LayoutList, Map as MapIcon } from 'lucide-react';

import { Button } from '../../components/ui/button';
import { Dialog, DialogTitle, SheetContent } from '../../components/ui/dialog';
import { cn } from '../../lib/cn';
import type { Capabilities } from '../../lib/capabilities';
import { LG_QUERY, XL_QUERY, useMediaQuery } from '../../lib/useMediaQuery';
import type { RealtimeConnectionState } from '../../lib/report-updates';
import { IncidentMap } from '../map/IncidentMap';
import { MapLegend } from '../map/MapLegend';
import {
  EMPTY_FILTERS,
  applyFilters,
  regionOptions,
  searchIncidents,
  sortIncidents,
  type CoordinatorIncident,
  type IncidentFeedState,
  type IncidentFilters,
  type IncidentSort,
  type IncidentTimelineState,
  type ReportActivity,
} from '../coordinator/incidents';
import type { TransitionRequest, TransitionUiState } from '../coordinator/useReportTransition';
import type { AssignTeamRequest, AssignTeamUiState } from '../coordinator/useAssignTeam';
import type { TeamOption } from '../coordinator/useTeams';
import { IncidentDetailPanel } from './IncidentDetailPanel';
import { IncidentQueuePanel } from './IncidentQueuePanel';
import { OverviewPanel } from './OverviewPanel';

/**
 * The map-first operational workspace (CRIS-54, ADR-0055).
 *
 * One live picture — map, queue, and detail — rather than the previous grid of
 * ticket-labelled panels. The map holds the centre because a crisis is
 * fundamentally spatial: "what is happening near this collapsed bridge" is not a
 * question a table answers.
 *
 * ── Why the layout branches in JS, not CSS ─────────────────────────────────
 * The detail rail is a real third column on a wide screen and an overlay sheet
 * on a narrow one. Rendering both and hiding one with `lg:hidden` would put the
 * panel in the DOM twice, duplicating its heading id, its live regions, and its
 * focus targets — so the breakpoint is read with `useMediaQuery` and exactly one
 * instance is mounted.
 *
 * Selection is shared state across all three views: clicking a map pin
 * highlights the queue row, and selecting a queue row pans the map. That is the
 * whole point of putting them side by side.
 */

/** Below `lg` only one pane fits at a time. */
type NarrowPane = 'map' | 'queue';

export function IncidentWorkspace({
  feed,
  realtime,
  activity,
  timeline,
  capabilities,
  callerRole,
  selectedId,
  onSelectIncident,
  onTransition,
  transition,
  onAssignTeam,
  assignment,
  teams,
}: {
  feed: IncidentFeedState;
  realtime: RealtimeConnectionState;
  activity: readonly ReportActivity[];
  timeline: IncidentTimelineState;
  capabilities: Capabilities;
  callerRole: UserRole;
  selectedId: string | null;
  onSelectIncident: (reportId: string | null) => void;
  onTransition?: (request: TransitionRequest) => void;
  transition: TransitionUiState;
  onAssignTeam?: (request: AssignTeamRequest) => void;
  assignment: AssignTeamUiState;
  teams: readonly TeamOption[];
}) {
  const isXl = useMediaQuery(XL_QUERY);
  const isLg = useMediaQuery(LG_QUERY);

  const [filters, setFilters] = useState<IncidentFilters>(EMPTY_FILTERS);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<IncidentSort>('priority');
  const [narrowPane, setNarrowPane] = useState<NarrowPane>('map');

  const incidents: CoordinatorIncident[] = feed.status === 'ready' ? feed.incidents : [];
  const selected = incidents.find((incident) => incident.reportId === selectedId) ?? null;

  // The map plots exactly what the queue lists. Showing every incident on the
  // map while the queue is filtered would put pins on screen with no
  // corresponding row — unreachable by keyboard, and confusing by mouse.
  const visible = sortIncidents(searchIncidents(applyFilters(incidents, filters), query), sort);

  const queue = (
    <IncidentQueuePanel
      feed={feed}
      filters={filters}
      onFiltersChange={setFilters}
      query={query}
      onQueryChange={setQuery}
      sort={sort}
      onSortChange={setSort}
      regions={regionOptions(incidents)}
      selectedId={selectedId}
      onSelect={(reportId) => {
        onSelectIncident(reportId);
        // On a narrow screen the queue covers the map, so a selection would
        // otherwise pan a map the user cannot see. Follow them to it.
        if (!isLg) setNarrowPane('map');
      }}
      className="h-full"
    />
  );

  const detail = selected ? (
    <IncidentDetailPanel
      incident={selected}
      timeline={timeline}
      capabilities={capabilities}
      callerRole={callerRole}
      onClose={() => onSelectIncident(null)}
      onTransition={onTransition}
      transition={transition}
      onAssignTeam={onAssignTeam}
      assignment={assignment}
      teams={teams}
      className="h-full"
    />
  ) : null;

  const map = (
    <div className="relative h-full w-full">
      <IncidentMap
        className="absolute inset-0"
        incidents={visible}
        selectedId={selectedId}
        onSelectIncident={onSelectIncident}
      />
      <MapLegend className="absolute bottom-6 left-3 z-[2]" />
    </div>
  );

  return (
    <div className="flex min-h-0 w-full flex-1">
      {/* ── Queue column (lg and up) ───────────────────────────────────────── */}
      {isLg ? (
        <div className="w-[21rem] shrink-0 border-r border-border xl:w-[23rem]">{queue}</div>
      ) : null}

      {/* ── Centre ─────────────────────────────────────────────────────────── */}
      <div className="relative min-w-0 flex-1">
        {isLg ? (
          map
        ) : (
          <>
            {/* Below lg, one pane at a time with an explicit switch. Tabs rather
                than a swipe: a gesture is undiscoverable, and this surface is
                operated under pressure by people who have never been trained on
                it. */}
            <div
              role="group"
              aria-label="Workspace pane"
              className="absolute left-1/2 top-3 z-[3] flex -translate-x-1/2 gap-0.5 rounded-lg border border-border bg-surface p-0.5 shadow-md"
            >
              {(
                [
                  ['map', 'Map', MapIcon],
                  ['queue', 'Queue', LayoutList],
                ] as const
              ).map(([pane, label, Icon]) => (
                <Button
                  key={pane}
                  variant="ghost"
                  size="sm"
                  aria-pressed={narrowPane === pane}
                  onClick={() => setNarrowPane(pane)}
                  className={cn(
                    'h-8',
                    narrowPane === pane && 'bg-accent-subtle text-accent-subtle-fg',
                  )}
                >
                  <Icon aria-hidden="true" />
                  {label}
                </Button>
              ))}
            </div>
            <div className="h-full">{narrowPane === 'map' ? map : queue}</div>
          </>
        )}
      </div>

      {/* ── Detail rail (xl) ───────────────────────────────────────────────── */}
      {isXl ? (
        <div className="w-[23rem] shrink-0 border-l border-border">
          {detail ?? (
            <OverviewPanel
              incidents={incidents}
              activity={activity}
              realtime={realtime}
              className="h-full"
            />
          )}
        </div>
      ) : null}

      {/* ── Detail as a sheet (below xl) ───────────────────────────────────── */}
      {!isXl ? (
        <Dialog
          open={selected != null}
          onOpenChange={(open) => {
            if (!open) onSelectIncident(null);
          }}
        >
          <SheetContent
            side={isLg ? 'right' : 'bottom'}
            className={cn('p-0', !isLg && 'h-[80vh]')}
            // The panel supplies its own header and close button; the sheet's
            // built-in close would be a second, redundant control in the same
            // corner.
            hideClose
          >
            {/* Radix requires a title on every dialog, and it is what a screen
                reader announces on open. Hidden visually because the panel
                below already shows the incident summary as its heading. */}
            <DialogTitle className="sr-only">Incident detail</DialogTitle>
            {detail}
          </SheetContent>
        </Dialog>
      ) : null}
    </div>
  );
}
