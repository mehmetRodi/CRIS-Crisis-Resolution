import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Send, TriangleAlert } from 'lucide-react';

import { EmptyState } from '../../components/domain/EmptyState';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/cn';
import { pluralize } from '../../lib/format';
import { CitizenShell } from '../../shell/CitizenShell';
import { IncidentMap } from './IncidentMap';
import { MapLegend } from './MapLegend';
import { usePublicIncidents } from './usePublicIncidents';

/**
 * The public incident map (`/map`, CRIS-13 → CRIS-54, ADR-0056).
 *
 * Unauthenticated and open to anyone. Its purpose is practical rather than
 * informational: someone about to report a fire they can see from their window
 * can check whether it is already known, which cuts duplicate reports during
 * exactly the surge when duplicate handling is most expensive.
 *
 * It shows only CONFIRMED incidents — the server withholds anything a human has
 * not verified (see `PUBLICLY_VISIBLE_STATUSES`). The banner says so, because a
 * public map that silently omits half the picture is worse than one that
 * explains what it is showing.
 *
 * Mounted in `CitizenShell`, not the operational shell: this is a citizen
 * surface and carries no role chip, navigation, or account controls.
 */
export function PublicMapPage() {
  const { state, refresh } = usePublicIncidents();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const incidents = state.status === 'ready' ? state.incidents : [];

  return (
    <CitizenShell bleed>
      <div className="absolute inset-0">
        <IncidentMap
          className="absolute inset-0"
          incidents={incidents}
          selectedId={selectedId}
          onSelectIncident={setSelectedId}
        />

        {/* ── What this map is ──────────────────────────────────────────── */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[2] p-4">
          <div className="pointer-events-auto mx-auto flex max-w-2xl flex-wrap items-center gap-3 rounded-2xl border border-border/80 bg-surface/90 px-4 py-3 shadow-lg backdrop-blur-md">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="flex size-2 rounded-full bg-success"></span>
                <p className="text-xs font-bold uppercase tracking-wider text-fg">
                  Confirmed Incidents
                </p>
              </div>
              <p className="mt-0.5 text-xs text-fg-muted">
                {state.status === 'loading'
                  ? 'Loading live map data…'
                  : state.status === 'error'
                    ? 'Could not load incidents.'
                    : `${pluralize(incidents.length, 'incident')} verified by coordinators. Unconfirmed reports are withheld.`}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={refresh}
              aria-label="Refresh incidents"
              className="rounded-lg hover:bg-surface-hover"
            >
              <RefreshCw
                aria-hidden="true"
                className={cn('size-4 text-fg-muted', state.status === 'loading' && 'animate-spin')}
              />
            </Button>
            <Button
              variant="primary"
              size="sm"
              asChild
              className="shrink-0 rounded-xl font-semibold shadow-xs"
            >
              <Link to="/report">
                <Send aria-hidden="true" className="size-3.5" />
                Report
              </Link>
            </Button>
          </div>

          {state.status === 'error' ? (
            <div className="pointer-events-auto mx-auto mt-3 max-w-2xl">
              <EmptyState
                tone="error"
                icon={TriangleAlert}
                title="Couldn't load the incident map"
                description={state.message}
                action={
                  <Button variant="secondary" size="sm" onClick={refresh}>
                    Try again
                  </Button>
                }
                className="border-solid bg-surface"
              />
            </div>
          ) : null}
        </div>

        <MapLegend className="absolute bottom-6 left-3 z-[2]" />
      </div>
    </CitizenShell>
  );
}
