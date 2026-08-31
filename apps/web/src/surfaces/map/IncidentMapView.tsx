import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { GeoJSONSource, MapGeoJSONFeature, MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { PublicReport } from '@crisismap/shared';

import { cn } from '../../lib/cn';
import { bandColorExpression, clusterColorExpression, mapPalette } from './mapColors';
import { plottableCount, toIncidentGeoJson } from './incidentGeoJson';
import { resolveMapStyle } from './mapStyle';

/**
 * The live incident map (CRIS-13 base map → CRIS-54 incident overlay, ADR-0025).
 *
 * Previously a bare base map with no data on it. It now renders the redacted
 * incident feed as severity-coloured, clustered points and reports selection
 * back to the workspace, which is what makes the map-first layout a working
 * surface rather than decoration (ADR-0055).
 *
 * Heavy by design — `maplibre-gl` is ~200 kB gzipped — so it stays behind the
 * `React.lazy` boundary in `IncidentMap` and is default-exported for it.
 *
 * ── Accessibility ──────────────────────────────────────────────────────────
 * A WebGL canvas cannot be made keyboard-navigable in any meaningful way: its
 * "content" is pixels. Rather than pretend otherwise with a fake focus ring,
 * the map is labelled honestly and the incident QUEUE beside it is the
 * equivalent accessible view — same data, same selection, fully operable by
 * keyboard. The visually-hidden summary below keeps a screen-reader user
 * informed of what the canvas currently holds, including how many incidents
 * are missing coordinates and therefore absent from it (CRIS-27).
 *
 * ── Data ───────────────────────────────────────────────────────────────────
 * Consumes `PublicReport` only. The map is the least-trusted surface in the
 * product — a public route renders this same component — so it must never be
 * handed a shape that carries reporter identity or the raw report body (§5.6).
 */

const SOURCE_ID = 'incidents';
const LAYER_CLUSTERS = 'incident-clusters';
const LAYER_CLUSTER_COUNT = 'incident-cluster-count';
const LAYER_POINTS = 'incident-points';
const LAYER_SELECTED = 'incident-selected';

/** Neutral wide view, used until there is something to frame. */
const DEFAULT_CENTER: [number, number] = [10, 47];
const DEFAULT_ZOOM = 3;
/** Zoom applied when the workspace selects an incident from the queue. */
const FOCUS_ZOOM = 13;

export interface IncidentMapProps {
  /** Redacted incidents to plot. Those without coordinates are skipped. */
  incidents?: readonly PublicReport[];
  /** Currently selected incident; drawn with a halo and centred when it changes. */
  selectedId?: string | null;
  /** Fired when a point is clicked. Clicking empty map clears with `null`. */
  onSelectIncident?: (reportId: string | null) => void;
  /** Initial viewport centre `[lng, lat]`. Initial-only. */
  center?: [number, number];
  /** Initial zoom. Initial-only. */
  zoom?: number;
  className?: string;
}

export default function IncidentMapView({
  incidents = [],
  selectedId = null,
  onSelectIncident,
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  className,
}: IncidentMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [failed, setFailed] = useState(false);
  /** Gates every data write: layers do not exist until the style has loaded. */
  const [ready, setReady] = useState(false);
  const style = resolveMapStyle();

  // Selection handling lives in a ref so the click listener — registered once,
  // at style load — always calls the CURRENT handler. Re-registering listeners
  // whenever the callback identity changes would mean tearing down and
  // rebuilding layers on every parent render.
  const onSelectRef = useRef(onSelectIncident);
  onSelectRef.current = onSelectIncident;

  /* ---------------------------------------------------------------------- */
  /* Map lifecycle                                                          */
  /* ---------------------------------------------------------------------- */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      style: style.url,
      center,
      zoom,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    const onError = () => setFailed(true);
    map.on('error', onError);

    const onLoad = () => {
      const palette = mapPalette();

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterRadius: 48,
        // Stop clustering before the deepest zooms, so a coordinator who has
        // zoomed to a street is looking at individual incidents, not a bubble.
        clusterMaxZoom: 13,
        // Per-band tallies, so a cluster can be coloured by the worst incident
        // it contains rather than by an average that could hide a P0.
        clusterProperties: {
          p0: ['+', ['case', ['==', ['get', 'band'], 'P0'], 1, 0]],
          p1: ['+', ['case', ['==', ['get', 'band'], 'P1'], 1, 0]],
          p2: ['+', ['case', ['==', ['get', 'band'], 'P2'], 1, 0]],
        },
      });

      map.addLayer({
        id: LAYER_CLUSTERS,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': clusterColorExpression(palette) as never,
          'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 50, 26] as never,
          'circle-opacity': 0.9,
          'circle-stroke-width': 2,
          'circle-stroke-color': palette.surface,
        },
      });

      map.addLayer({
        id: LAYER_CLUSTER_COUNT,
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'] as never,
          'text-size': 12,
          'text-font': ['Noto Sans Bold', 'Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-allow-overlap': true,
        },
        paint: { 'text-color': palette.surface },
      });

      // Selection halo. Drawn BENEATH the points so the marker itself stays
      // fully visible; a ring painted on top would obscure the very incident it
      // is meant to highlight.
      map.addLayer({
        id: LAYER_SELECTED,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['==', ['get', 'reportId'], ''],
        paint: {
          'circle-radius': 15,
          'circle-color': palette.accent,
          'circle-opacity': 0.22,
          'circle-stroke-width': 2,
          'circle-stroke-color': palette.accent,
        },
      });

      map.addLayer({
        id: LAYER_POINTS,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': bandColorExpression(palette) as never,
          'circle-radius': 7,
          'circle-stroke-width': 2,
          'circle-stroke-color': palette.surface,
        },
      });

      /* -- Interaction ---------------------------------------------------- */

      map.on('click', LAYER_POINTS, (event: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
        const reportId = event.features?.[0]?.properties?.reportId;
        if (typeof reportId === 'string') onSelectRef.current?.(reportId);
      });

      // Clicking a cluster drills into it rather than doing nothing — otherwise
      // the only way to reach a clustered incident is to guess a zoom level.
      map.on(
        'click',
        LAYER_CLUSTERS,
        (event: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
          const feature = event.features?.[0];
          const clusterId = feature?.properties?.cluster_id;
          if (clusterId == null) return;
          const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
          void source?.getClusterExpansionZoom(Number(clusterId)).then((expansionZoom) => {
            const geometry = feature?.geometry;
            if (geometry?.type !== 'Point') return;
            map.easeTo({
              center: geometry.coordinates as [number, number],
              zoom: expansionZoom,
            });
          });
        },
      );

      for (const layer of [LAYER_POINTS, LAYER_CLUSTERS]) {
        map.on('mouseenter', layer, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layer, () => {
          map.getCanvas().style.cursor = '';
        });
      }

      setReady(true);
    };

    map.on('load', onLoad);

    return () => {
      setReady(false);
      mapRef.current = null;
      map.off('error', onError);
      map.remove();
    };
    // `center`/`zoom` are initial-only (see prop docs); re-initialise solely on a
    // tile-source change, so an Amazon Location cutover applies without a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style.url]);

  /* ---------------------------------------------------------------------- */
  /* Data                                                                    */
  /* ---------------------------------------------------------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(toIncidentGeoJson(incidents) as never);
  }, [incidents, ready]);

  /* ---------------------------------------------------------------------- */
  /* Selection                                                               */
  /* ---------------------------------------------------------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    // An empty-string id matches nothing, which is how the halo is hidden —
    // MapLibre has no "match no features" filter, and removing/re-adding the
    // layer on every selection change would flicker.
    map.setFilter(LAYER_SELECTED, ['==', ['get', 'reportId'], selectedId ?? '']);

    if (!selectedId) return;
    const target = incidents.find((incident) => incident.reportId === selectedId);
    if (target?.lat == null || target?.lng == null) return;
    map.easeTo({
      center: [target.lng, target.lat],
      // Never zoom OUT on selection: a coordinator who has deliberately zoomed
      // into a street should not be thrown back to city scale by clicking a row.
      zoom: Math.max(map.getZoom(), FOCUS_ZOOM),
      duration: 600,
    });
  }, [selectedId, incidents, ready]);

  const plotted = plottableCount(incidents);
  const missing = incidents.length - plotted;

  return (
    <div className={cn('relative h-full w-full', className)}>
      <div
        ref={containerRef}
        role="application"
        aria-label="Incident map"
        className="h-full w-full"
      />

      {/*
        What the canvas currently holds, for anyone who cannot see it. Always
        mounted so the live region is already observed when its text changes
        (ADR-0037), and it names the queue as the operable alternative rather
        than leaving a keyboard user at a dead end.
      */}
      <div role="status" className="sr-only">
        {failed
          ? 'Map unavailable. Base tiles could not be loaded. The incident list remains available.'
          : `Map showing ${plotted} of ${incidents.length} incidents.` +
            (missing > 0 ? ` ${missing} have no location yet and are not on the map.` : '') +
            ' Use the incident list to browse and select incidents by keyboard.'}
      </div>

      {style.isDemo ? (
        <span className="pointer-events-none absolute left-2 top-2 z-[1] rounded-sm bg-fg/80 px-2 py-0.5 text-[11px] font-medium text-fg-on-solid">
          Demo tiles
        </span>
      ) : null}

      {/*
        Failure is otherwise silent — the canvas simply stays blank, which looks
        identical to "no incidents in view". Cover it with an explicit notice.
      */}
      {failed ? (
        <div className="absolute inset-0 z-[1] flex items-center justify-center bg-bg/95 p-6 text-center">
          <p className="max-w-xs text-sm text-fg-muted">
            Map unavailable — base tiles could not be loaded. Incidents are still listed beside the
            map.
          </p>
        </div>
      ) : null}
    </div>
  );
}
