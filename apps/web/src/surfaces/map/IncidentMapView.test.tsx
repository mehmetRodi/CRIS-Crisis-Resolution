import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// MapLibre GL needs WebGL, which jsdom does not provide. This file asserts the
// map's lifecycle, so it overrides the global stub (vitest.setup.ts) with its own
// factory backed by referenceable spies. `vi.hoisted` lets the spies exist above
// the hoisted `vi.mock`. See ADR-0025 and docs/conventions.md → Testing.
const { addControl, remove, handlers, MapMock, NavigationControl } = vi.hoisted(() => {
  const addControl = vi.fn();
  const remove = vi.fn();
  // Captured so a test can drive the map's own `error` event — the only way to
  // reach the degraded-tiles branch without real WebGL.
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    addControl,
    remove,
    handlers,
    MapMock: vi.fn(() => ({
      addControl,
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => handlers.set(event, cb)),
      off: vi.fn((event: string) => handlers.delete(event)),
      remove,
    })),
    NavigationControl: vi.fn(),
  };
});

vi.mock('maplibre-gl', () => ({
  default: { Map: MapMock, NavigationControl },
}));

import { DEMO_MAP_STYLE } from './mapStyle';
import IncidentMapView from './IncidentMapView';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  handlers.clear();
});

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

    // Mounted and empty before anything fails. That is deliberate, not spare
    // markup: assistive tech only reports a live region it was already
    // watching, so a region inserted together with its text is missed
    // (ADR-0037). Asserting emptiness pins the behaviour the fix depends on.
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    act(() => handlers.get('error')?.());

    expect(screen.getByRole('status')).toHaveTextContent(/map unavailable/i);
  });
});
