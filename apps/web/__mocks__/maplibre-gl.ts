import { vi } from 'vitest';

/**
 * Test double for `maplibre-gl` (CRIS-16). jsdom has no WebGL context, and the
 * real library throws on import (`window.URL.createObjectURL` / worker setup)
 * before a `Map` is ever constructed — so components that use it need this
 * module mocked, not just a stubbed instance. Activate with `vi.mock('maplibre-gl')`
 * in a test file; Vitest picks up this file automatically for that package.
 *
 * Only implements the surface `LocationPicker` touches.
 */
export class Marker {
  private lngLat: { lng: number; lat: number } = { lng: 0, lat: 0 };

  setLngLat(lngLat: [number, number]) {
    this.lngLat = { lng: lngLat[0], lat: lngLat[1] };
    return this;
  }

  getLngLat() {
    return this.lngLat;
  }

  addTo() {
    return this;
  }

  on = vi.fn();
}

export class NavigationControl {}

export class Map {
  on = vi.fn();
  addControl = vi.fn();
  flyTo = vi.fn();
  remove = vi.fn();
}

export default { Map, Marker, NavigationControl };
