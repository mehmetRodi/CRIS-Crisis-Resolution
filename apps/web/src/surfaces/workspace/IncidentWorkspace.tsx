import { useState } from 'react';
import type { UserRole } from '@crisismap/shared';
import { LayoutList, Map as MapIcon, PanelRight, RotateCcw } from 'lucide-react';

import { Button } from '../../components/ui/button';
import { Dialog, DialogTitle, SheetContent } from '../../components/ui/dialog';
import { cn } from '../../lib/cn';
import type { Capabilities } from '../../lib/capabilities';
import { LG_QUERY, useMediaQuery } from '../../lib/useMediaQuery';
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
import { PanelResizeHandle } from './PanelResizeHandle';

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
  const isLg = useMediaQuery(LG_QUERY);

  const [filters, setFilters] = useState<IncidentFilters>(EMPTY_FILTERS);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<IncidentSort>('priority');
  const [panels, setPanels] = useState({ queue: true, map: true, details: true });
  const [queueWidth, setQueueWidth] = useState(300);
  const [detailWidth, setDetailWidth] = useState(320);
  const [narrowPane, setNarrowPane] = useState<NarrowPane>('map');

  const incidents: CoordinatorIncident[] = feed.status === 'ready' ? feed.incidents : [];
  const selected = incidents.find((incident) => incident.reportId === selectedId) ?? null;

  // The map plots exactly what the queue lists. Showing every incident on the
  // map while the queue is filtered would put pins on screen with no
  // corresponding row — unreachable by keyboard, and confusing by mouse.
  const visible = sortIncidents(searchIncidents(applyFilters(incidents, filters), query), sort);

  function selectIncident(reportId: string | null) {
    onSelectIncident(reportId);
    if (reportId) setPanels((current) => ({ ...current, details: true }));
    if (!isLg) setNarrowPane('map');
  }

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
      onSelect={selectIncident}
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
        onSelectIncident={selectIncident}
      />
      <MapLegend className="absolute bottom-6 left-3 z-[2]" />
    </div>
  );

  const overview = (
    <OverviewPanel
      incidents={incidents}
      activity={activity}
      realtime={realtime}
      className="h-full"
    />
  );
  const visiblePanelCount = Object.values(panels).filter(Boolean).length;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xs">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Incident workspace</h1>
          <p className="mt-0.5 text-xs text-fg-muted">
            {isLg
              ? 'Choose your panels. Drag the dividers to resize.'
              : 'Switch between the incident list and map.'}
          </p>
        </div>
        <div
          role="group"
          aria-label="Visible workspace panels"
          className="flex flex-wrap items-center gap-1"
        >
          {isLg ? (
            <>
              {(
                [
                  ['queue', 'Incident list', LayoutList],
                  ['map', 'Map', MapIcon],
                  ['details', 'Overview & details', PanelRight],
                ] as const
              ).map(([key, label, Icon]) => (
                <Button
                  key={key}
                  variant="ghost"
                  size="sm"
                  aria-pressed={panels[key]}
                  aria-controls={`incident-pane-${key}`}
                  aria-disabled={panels[key] && visiblePanelCount === 1}
                  aria-describedby={
                    panels[key] && visiblePanelCount === 1 ? 'panel-minimum' : undefined
                  }
                  onClick={() =>
                    setPanels((current) =>
                      current[key] && Object.values(current).filter(Boolean).length === 1
                        ? current
                        : { ...current, [key]: !current[key] },
                    )
                  }
                  className={cn(panels[key] && 'bg-accent-subtle text-accent-subtle-fg')}
                >
                  <Icon aria-hidden="true" />
                  {label}
                </Button>
              ))}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Reset workspace layout"
                title="Reset layout"
                onClick={() => {
                  setPanels({ queue: true, map: true, details: true });
                  setQueueWidth(300);
                  setDetailWidth(320);
                }}
              >
                <RotateCcw aria-hidden="true" />
              </Button>
              <span id="panel-minimum" className="sr-only">
                Keep at least one panel visible.
              </span>
            </>
          ) : (
            (['queue', 'map'] as const).map((pane) => (
              <Button
                key={pane}
                variant="ghost"
                size="sm"
                aria-pressed={narrowPane === pane}
                onClick={() => setNarrowPane(pane)}
                className={cn(narrowPane === pane && 'bg-accent-subtle text-accent-subtle-fg')}
              >
                {pane === 'map' ? (
                  <MapIcon aria-hidden="true" />
                ) : (
                  <LayoutList aria-hidden="true" />
                )}
                {pane === 'map' ? 'Map' : 'Incident list'}
              </Button>
            ))
          )}
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1">
        {isLg ? (
          <>
            {panels.queue ? (
              <div
                id="incident-pane-queue"
                className={cn(
                  'min-w-0',
                  visiblePanelCount === 1 || !panels.map ? 'flex-1' : 'shrink-0',
                )}
                style={
                  panels.map
                    ? { width: queueWidth, maxWidth: panels.details ? '35%' : '60%' }
                    : undefined
                }
              >
                {queue}
              </div>
            ) : null}
            {panels.queue && visiblePanelCount > 1 ? (
              <PanelResizeHandle
                label={panels.map ? 'Resize incident list' : 'Resize overview and details'}
                controls={panels.map ? 'incident-pane-queue' : 'incident-pane-details'}
                width={panels.map ? queueWidth : detailWidth}
                direction={panels.map ? 1 : -1}
                onResize={panels.map ? setQueueWidth : setDetailWidth}
              />
            ) : null}
            {panels.map ? (
              <div id="incident-pane-map" className="relative min-w-0 flex-1">
                {map}
              </div>
            ) : null}
            {panels.details && panels.map ? (
              <PanelResizeHandle
                label="Resize overview and details"
                controls="incident-pane-details"
                width={detailWidth}
                direction={-1}
                onResize={setDetailWidth}
              />
            ) : null}
            {panels.details ? (
              <div
                id="incident-pane-details"
                className={cn('min-w-0', visiblePanelCount === 1 ? 'flex-1' : 'shrink-0')}
                style={
                  visiblePanelCount > 1
                    ? { width: detailWidth, maxWidth: panels.map && panels.queue ? '35%' : '60%' }
                    : undefined
                }
              >
                {detail ?? overview}
              </div>
            ) : null}
          </>
        ) : (
          <div className="relative min-h-0 min-w-0 flex-1">
            {narrowPane === 'map' ? map : queue}
          </div>
        )}
      </div>
      {!isLg ? (
        <Dialog
          open={selected != null}
          onOpenChange={(open) => {
            if (!open) onSelectIncident(null);
          }}
        >
          <SheetContent
            side="bottom"
            className="h-[80vh] p-0"
            hideClose
            aria-describedby={undefined}
          >
            <DialogTitle className="sr-only">Incident detail</DialogTitle>
            {detail}
          </SheetContent>
        </Dialog>
      ) : null}
    </div>
  );
}
