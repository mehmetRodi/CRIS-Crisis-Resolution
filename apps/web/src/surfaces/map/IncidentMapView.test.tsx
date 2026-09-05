import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// MapLibre GL needs WebGL, which jsdom does not provide. This file asserts the
// map's lifecycle, so it overrides the global stub (vitest.setup.ts) with its own
// factory backed by referenceable spies. `vi.hoisted` lets the spies exist above
// the hoisted `vi.mock`. See ADR-0025 and docs/conventions.md → Testing.
const {
  addControl,
  remove,
  handlers,
  addSource,
  addLayer,
  setFilter,
  setData,
  easeTo,
  MapMock,
  NavigationControl,
} = vi.hoisted(() => {
  const addControl = vi.fn();
  const remove = vi.fn();
  const addSource = vi.fn();
  const addLayer = vi.fn();
  const setFilter = vi.fn();
  const setData = vi.fn();
  const easeTo = vi.fn();
  // Captured so a test can drive the map's own `error` and `load` events — the
  // only way to reach the degraded-tiles branch and the layer setup without
  // real WebGL. Layer-scoped handlers (`on('click', LAYER, fn)`) are keyed by
  // "event:layer" so a click on points and a click on clusters stay distinct.
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    addControl,
    remove,
    handlers,
    addSource,
    addLayer,
    setFilter,
    setData,
    easeTo,
    MapMock: vi.fn(() => ({
      addControl,
      on: vi.fn((event: string, second: unknown, third?: unknown) => {
        const layerScoped = typeof second === 'string';
        const key = layerScoped ? `${event}:${second}` : event;
        handlers.set(key, (layerScoped ? third : second) as (...args: unknown[]) => void);
      }),
      off: vi.fn((event: string) => handlers.delete(event)),
      remove,
      addSource,
      addLayer,
      setFilter,
      getSource: vi.fn(() => ({ setData, getClusterExpansionZoom: vi.fn() })),
      getCanvas: vi.fn(() => ({ style: {} })),
      getZoom: vi.fn(() => 3),
      easeTo,
    })),
    NavigationControl: vi.fn(),
  };
});

vi.mock('maplibre-gl', () => ({
  default: { Map: MapMock, NavigationControl },
}));

import type { PublicReport } from '@crisismap/shared';

import { DEMO_MAP_STYLE } from './mapStyle';
import IncidentMapView from './IncidentMapView';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  handlers.clear();
});

/** A minimal redacted incident. Fields are overridden per assertion. */
const PUBLIC_REPORT_FIXTURE: PublicReport = {
  reportId: 'r1',
  status: 'VERIFIED',
  category: 'FIRE',
  urgency: 'HIGH',
  priorityScore: 7.2,
  priorityBand: 'P1',
  summary: 'Stairwell fire reported.',
  lat: 0,
  lng: 0,
  geohash: null,
  geohashPrefix: null,
  regionId: 'central',
  createdAt: '2026-08-31T10:00:00.000Z',
  updatedAt: '2026-08-31T10:00:00.000Z',
};

describe('IncidentMapView', () => {
  it('renders an accessible map region', () => {
    render(<IncidentMapView />);
    expect(screen.getByRole('application', { name: /incident map/i })).toBeInTheDocument();
  });

  it('constructs a MapLibre map from the resolved (demo) style with a nav control', () => {
    render(<IncidentMapView />);
    expect(MapMock).toHaveBeenCalledOnce();
    expect(MapMock).toHaveBeenCalledWith(expect.objectContaining({ style: DEMO_MAP_STYLE }));
    expect(NavigationControl).toHaveBeenCalledOnce();
    expect(NavigationControl).toHaveBeenCalledWith({ showCompass: true });
    expect(addControl).toHaveBeenCalledOnce();
  });

  it('shows the demo-tiles notice while Amazon Location is not configured', () => {
    render(<IncidentMapView />);
    expect(screen.getByText(/demo tiles/i)).toBeInTheDocument();
  });

  it('tears the map down on unmount to avoid WebGL context leaks', () => {
    const { unmount } = render(<IncidentMapView />);
    unmount();
    expect(remove).toHaveBeenCalledOnce();
  });

  // CRIS-27: a blank canvas is indistinguishable from a working map without
  // sight, so the degraded state has to be announced, not just drawn.
  it('announces the degraded state when the tile source fails', () => {
    render(<IncidentMapView />);

    // Mounted and already describing the map BEFORE anything fails. That is the
    // property ADR-0037 depends on: assistive tech only reports a live region it
    // was already watching, so a region inserted together with its text is
    // missed. What it says changes; whether it exists must not.
    const region = screen.getByRole('status');
    expect(region).toBeInTheDocument();
    expect(region).not.toHaveTextContent(/map unavailable/i);

    act(() => handlers.get('error')?.());

    expect(screen.getByRole('status')).toHaveTextContent(/map unavailable/i);
  });

  // CRIS-54: the map is pointer-driven by nature, so a non-sighted user needs
  // to know both what it holds and that the queue is the operable equivalent.
  it('states how many incidents are plotted and points to the keyboard path', () => {
    render(
      <IncidentMapView
        incidents={[
          { ...PUBLIC_REPORT_FIXTURE, reportId: 'a', lat: 1, lng: 2 },
          // No coordinates yet — geocoding has not resolved, so it cannot be
          // drawn. Silently dropping it would misreport the incident count.
          { ...PUBLIC_REPORT_FIXTURE, reportId: 'b', lat: null, lng: null },
        ]}
      />,
    );

    const region = screen.getByRole('status');
    expect(region).toHaveTextContent(/showing 1 of 2 incidents/i);
    expect(region).toHaveTextContent(/1 have no location yet/i);
    expect(region).toHaveTextContent(/incident list/i);
  });

  describe('incident overlay (CRIS-54)', () => {
    /** Brings the map to the state where its layers exist. */
    function load() {
      act(() => handlers.get('load')?.());
    }

    it('clusters incidents and tallies each band separately', () => {
      render(<IncidentMapView incidents={[PUBLIC_REPORT_FIXTURE]} />);
      load();

      const [, source] = addSource.mock.calls[0] as [string, Record<string, unknown>];
      expect(source.cluster).toBe(true);

      // The per-band counts are what let a cluster be coloured by the WORST
      // incident inside it. Without them a cluster containing a single P0 could
      // render as routine, hiding a life-threatening incident behind a zoom
      // level — the one failure this map must not have.
      expect(Object.keys(source.clusterProperties as object)).toEqual(['p0', 'p1', 'p2']);
    });

    it('draws the selection halo beneath the incident points', () => {
      render(<IncidentMapView incidents={[PUBLIC_REPORT_FIXTURE]} />);
      load();

      const order = addLayer.mock.calls.map(([layer]) => (layer as { id: string }).id);
      // Painted on top, the halo would obscure the very incident it highlights.
      expect(order.indexOf('incident-selected')).toBeLessThan(order.indexOf('incident-points'));
    });

    it('pushes the incident feed into the source once the style has loaded', () => {
      render(<IncidentMapView incidents={[PUBLIC_REPORT_FIXTURE]} />);
      load();

      const collection = setData.mock.calls.at(-1)?.[0] as {
        features: { properties: { reportId: string } }[];
      };
      expect(collection.features).toHaveLength(1);
      expect(collection.features[0]?.properties.reportId).toBe('r1');
    });

    it('does not write data before the style has loaded', () => {
      // The layers do not exist until `load` fires; writing early throws inside
      // MapLibre rather than failing softly.
      render(<IncidentMapView incidents={[PUBLIC_REPORT_FIXTURE]} />);
      expect(setData).not.toHaveBeenCalled();
    });

    it('reports the clicked incident rather than selecting it internally', () => {
      const onSelectIncident = vi.fn();
      render(
        <IncidentMapView incidents={[PUBLIC_REPORT_FIXTURE]} onSelectIncident={onSelectIncident} />,
      );
      load();

      act(() =>
        handlers.get('click:incident-points')?.({
          features: [{ properties: { reportId: 'r1' } }],
        }),
      );

      // Selection is owned by the workspace so the map, the queue, and the
      // detail rail all agree on one selected incident.
      expect(onSelectIncident).toHaveBeenCalledWith('r1');
    });

    it('highlights the selected incident and never zooms out to reach it', () => {
      render(
        <IncidentMapView
          incidents={[{ ...PUBLIC_REPORT_FIXTURE, lat: 10, lng: 20 }]}
          selectedId="r1"
        />,
      );
      load();

      expect(setFilter).toHaveBeenCalledWith('incident-selected', [
        '==',
        ['get', 'reportId'],
        'r1',
      ]);
      // A coordinator who has zoomed into a street must not be thrown back to
      // city scale by clicking a queue row, so the camera only ever zooms IN.
      const [camera] = easeTo.mock.calls.at(-1) as [{ zoom: number }];
      expect(camera.zoom).toBeGreaterThanOrEqual(3);
    });
  });
});

it('contains a WebGL startup failure inside the map', () => {
  MapMock.mockImplementationOnce(() => {
    throw new Error('WebGL unavailable');
  });
  render(<IncidentMapView />);
  expect(screen.getByRole('status')).toHaveTextContent('Map unavailable');
});
