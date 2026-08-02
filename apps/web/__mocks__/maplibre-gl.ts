import { vi } from 'vitest';

/**
 * Test double for `maplibre-gl` (CRIS-16). jsdom has no WebGL context, and the
 * real library throws on import (`window.URL.createObjectURL` / worker setup)
 * before a `Map` is ever constructed — so components that use it need this
 * module mocked, not just a stubbed instance. Activate with `vi.mock('maplibre-gl')`
 * in a test file; Vitest picks up this file automatically for that package.
 *
 * Only implements the surface `LocationPicker` touches. Instances are recorded
 * on the classes and listeners are really stored, so tests can drive map
 * events (`instance.emit('click', …)`) and assert on camera moves — the
 * click/drag/clear paths are otherwise invisible from the DOM.
 *
 * The mocked module is shared across tests in a file, so reset `Map.instances`
 * and `Marker.instances` in `beforeEach`.
 */

type Listener = (payload?: unknown) => void;

/** `Map` is shadowed by the exported class below, so listeners use a record. */
function createEmitter() {
  const listeners: Record<string, Listener[]> = {};
  return {
    on(event: string, callback: Listener) {
      (listeners[event] ??= []).push(callback);
    },
    emit(event: string, payload?: unknown) {
      for (const callback of listeners[event] ?? []) callback(payload);
    },
  };
}

export class Marker {
  static instances: Marker[] = [];

  readonly options: unknown;
  /** True once `remove()` has been called — asserts the pin left the map. */
  removed = false;

  private lngLat: { lng: number; lat: number } = { lng: 0, lat: 0 };
  private events = createEmitter();

  constructor(options?: unknown) {
    this.options = options;
    Marker.instances.push(this);
  }

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

  remove() {
    this.removed = true;
    return this;
  }

  on(event: string, callback: Listener) {
    this.events.on(event, callback);
    return this;
  }

  /** Test-only: fire a marker event (e.g. `dragend`). */
  emit(event: string, payload?: unknown) {
    this.events.emit(event, payload);
  }
}

export class NavigationControl {}

export class Map {
  static instances: Map[] = [];

  readonly options: unknown;
  addControl = vi.fn();
  flyTo = vi.fn();
  remove = vi.fn();

  private events = createEmitter();

  constructor(options?: unknown) {
    this.options = options;
    Map.instances.push(this);
  }

  on(event: string, callback: Listener) {
    this.events.on(event, callback);
    return this;
  }

  /** Test-only: fire a map event (e.g. `click`). */
  emit(event: string, payload?: unknown) {
    this.events.emit(event, payload);
  }
}

export default { Map, Marker, NavigationControl };
