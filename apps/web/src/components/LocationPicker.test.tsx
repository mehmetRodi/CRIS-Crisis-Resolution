import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportLocation } from '@crisismap/shared';

// jsdom has no WebGL; maplibre-gl throws on import outside a real browser.
// See __mocks__/maplibre-gl.ts.
vi.mock('maplibre-gl');

import { Map as MapClass, Marker as MarkerClass } from 'maplibre-gl';
import { LocationPicker } from './LocationPicker';

/**
 * `vi.mock` swaps in `__mocks__/maplibre-gl.ts` at runtime, but TypeScript still
 * resolves the real package's types — so re-view the two classes through the
 * test double's recording shape.
 */
interface MockMap {
  options: unknown;
  flyTo: ReturnType<typeof vi.fn>;
  emit(event: string, payload?: unknown): void;
}
interface MockMarker {
  removed: boolean;
  setLngLat(lngLat: [number, number]): unknown;
  emit(event: string, payload?: unknown): void;
}
const MapMock = MapClass as unknown as { instances: MockMap[] };
const MarkerMock = MarkerClass as unknown as { instances: MockMarker[] };

const ISTANBUL: ReportLocation = { lat: 41.0082, lng: 28.9784 };

/** Real state, so map-originated changes actually flow back in as `value`. */
function ControlledPicker({ initial = null }: { initial?: ReportLocation | null }) {
  const [value, setValue] = useState<ReportLocation | null>(initial);
  return <LocationPicker value={value} onChange={setValue} />;
}

const lastMap = () => MapMock.instances[MapMock.instances.length - 1]!;
const lastMarker = () => MarkerMock.instances[MarkerMock.instances.length - 1]!;

describe('LocationPicker', () => {
  const getCurrentPosition = vi.fn();

  beforeEach(() => {
    // The mocked module is shared across tests in this file.
    MapMock.instances = [];
    MarkerMock.instances = [];
    getCurrentPosition.mockReset();
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    });
  });

  afterEach(() => {
    // @ts-expect-error -- test-only cleanup of the property defined above
    delete navigator.geolocation;
  });

  it('renders the map container and an initial prompt with no value', () => {
    render(<LocationPicker value={null} onChange={vi.fn()} />);
    expect(screen.getByTestId('location-map')).toBeInTheDocument();
    expect(screen.getByText(/tap the map to drop a pin/i)).toBeInTheDocument();
  });

  it('reports the GPS position through onChange on success', async () => {
    getCurrentPosition.mockImplementation((success: PositionCallback) => {
      success({
        coords: { latitude: ISTANBUL.lat, longitude: ISTANBUL.lng },
      } as GeolocationPosition);
    });
    const onChange = vi.fn();
    render(<LocationPicker value={null} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /use my location/i }));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ lat: ISTANBUL.lat, lng: ISTANBUL.lng }),
    );
  });

  it('shows an error when GPS fails, without calling onChange', async () => {
    getCurrentPosition.mockImplementation((_success, error?: PositionErrorCallback) => {
      error?.({} as GeolocationPositionError);
    });
    const onChange = vi.fn();
    render(<LocationPicker value={null} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /use my location/i }));

    expect(await screen.findByText(/could not get your location/i)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the resolved coordinate and a clear button once a value is set', () => {
    const onChange = vi.fn();
    render(<LocationPicker value={ISTANBUL} onChange={onChange} />);

    expect(screen.getByText(/41\.00820, 28\.97840/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('renders the map with attribution, as OpenStreetMap tiles require', () => {
    render(<LocationPicker value={null} onChange={vi.fn()} />);
    expect(lastMap().options).toMatchObject({ attributionControl: { compact: true } });
  });

  it('removes the marker from the map when the location is cleared', () => {
    render(<ControlledPicker initial={ISTANBUL} />);
    const marker = lastMarker();
    expect(marker.removed).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /clear/i }));

    expect(marker.removed).toBe(true);
    expect(screen.getByText(/tap the map to drop a pin/i)).toBeInTheDocument();
  });

  it('does not move the camera when the pin is placed by clicking the map', () => {
    render(<ControlledPicker />);
    const map = lastMap();

    act(() => map.emit('click', { lngLat: ISTANBUL }));

    expect(screen.getByText(/41\.00820, 28\.97840/)).toBeInTheDocument();
    // Flying here would yank the viewport and force-zoom on every click.
    expect(map.flyTo).not.toHaveBeenCalled();
  });

  it('does not move the camera when the marker is dragged', () => {
    render(<ControlledPicker initial={ISTANBUL} />);
    const map = lastMap();
    const marker = lastMarker();
    marker.setLngLat([28.9, 41.1]);

    act(() => marker.emit('dragend'));

    expect(screen.getByText(/41\.10000, 28\.90000/)).toBeInTheDocument();
    expect(map.flyTo).not.toHaveBeenCalled();
  });

  it('flies the camera to a location that arrives from outside the map', async () => {
    getCurrentPosition.mockImplementation((success: PositionCallback) => {
      success({
        coords: { latitude: ISTANBUL.lat, longitude: ISTANBUL.lng },
      } as GeolocationPosition);
    });
    render(<ControlledPicker />);
    const map = lastMap();

    fireEvent.click(screen.getByRole('button', { name: /use my location/i }));

    await waitFor(() =>
      expect(map.flyTo).toHaveBeenCalledWith({
        center: [ISTANBUL.lng, ISTANBUL.lat],
        zoom: 15,
      }),
    );
  });
});
