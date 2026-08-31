import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

/**
 * Radix primitives measure their own DOM (`@radix-ui/react-use-size` behind
 * `Switch`, `Select`, and the popper-positioned overlays), and jsdom implements
 * no `ResizeObserver`. Without this stub any component tree containing one of
 * those primitives throws on mount, which would make the report form and every
 * workspace panel untestable. A no-op is sufficient: nothing under test asserts
 * on measured sizes, only on structure and behaviour.
 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

/**
 * Radix uses these for pointer-capture and scroll-lock bookkeeping; jsdom
 * defines neither on `Element`, so a `Select` or `Dialog` interaction throws
 * mid-event rather than failing an assertion.
 */
// Guarded on `Element` existing at all: the backend tests (`amplify/**`) run in
// the node environment, where there is no DOM and touching `Element.prototype`
// is a ReferenceError during setup — which fails the whole FILE to collect,
// not just one assertion.
if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

/**
 * jsdom in this install exposes no `localStorage` at all — `typeof localStorage`
 * is `undefined`, not merely empty — so every offline-queue test (CRIS-26) fails
 * at setup rather than on an assertion. This is a pre-existing environment gap,
 * unrelated to any application change.
 *
 * A minimal in-memory `Storage` restores them. It implements the whole surface
 * the queue uses and behaves like the real thing in the ways that matter: keys
 * and values are coerced to strings, and a missing key returns `null` rather
 * than `undefined` — the distinction the queue's corrupt-data handling turns on.
 */
const memoryEntries = new WeakMap<Storage, Map<string, string>>();

function entriesFor(instance: Storage): Map<string, string> {
  let entries = memoryEntries.get(instance);
  if (!entries) {
    entries = new Map();
    memoryEntries.set(instance, entries);
  }
  return entries;
}

/**
 * Install a working `Storage` implementation onto `Storage.prototype`.
 *
 * jsdom DOES define the `Storage` interface here — `Storage.prototype.getItem`
 * exists — it just never exposes an instance on `window`, and its native
 * methods throw when called on an object that lacks the internal slot. So the
 * prototype methods are replaced outright rather than only filled in when
 * absent; there is no real `Storage` instance in this environment for the
 * replacement to break.
 *
 * The methods must live on the PROTOTYPE, not as own properties of the
 * instance: existing tests stub quota errors with
 * `vi.spyOn(Storage.prototype, 'setItem')`, and an own property would shadow
 * the spy so the stub would never fire. Per-instance state lives in a `WeakMap`
 * keyed by the instance, mirroring how the interface is actually specified.
 */
function installMemoryStorage(): Storage {
  const instance = (
    typeof Storage === 'function' ? Object.create(Storage.prototype) : {}
  ) as Storage;
  const prototype = (typeof Storage === 'function' ? Storage.prototype : instance) as Storage;

  Object.defineProperties(prototype, {
    length: {
      configurable: true,
      get(this: Storage) {
        return entriesFor(this).size;
      },
    },
    key: {
      configurable: true,
      writable: true,
      value(this: Storage, index: number) {
        return [...entriesFor(this).keys()][index] ?? null;
      },
    },
    getItem: {
      configurable: true,
      writable: true,
      // `null` for a missing key, never `undefined` — the offline queue's
      // corrupt-data handling branches on exactly that distinction.
      value(this: Storage, key: string) {
        return entriesFor(this).get(String(key)) ?? null;
      },
    },
    setItem: {
      configurable: true,
      writable: true,
      value(this: Storage, key: string, value: string) {
        entriesFor(this).set(String(key), String(value));
      },
    },
    removeItem: {
      configurable: true,
      writable: true,
      value(this: Storage, key: string) {
        entriesFor(this).delete(String(key));
      },
    },
    clear: {
      configurable: true,
      writable: true,
      value(this: Storage) {
        entriesFor(this).clear();
      },
    },
  });

  return instance;
}

if (typeof window !== 'undefined' && !window.localStorage) {
  const storage = installMemoryStorage();
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
}

/**
 * `useMediaQuery` drives the workspace's LAYOUT, not just its styling — it
 * decides whether the incident detail is a third column or an overlay sheet. So
 * it has to answer in jsdom, which implements no `matchMedia` at all.
 *
 * The stub reports NO match, which resolves to the narrow single-column layout.
 * That is the deliberate default: it is the simpler tree, and a test that wants
 * the wide layout can override `window.matchMedia` explicitly rather than every
 * test silently depending on a breakpoint it never mentioned.
 */
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/**
 * MapLibre GL requires a WebGL context and calls `URL.createObjectURL` at import
 * time, neither of which jsdom provides. Any test whose module graph includes a
 * map — the workspace, the public map, the report form's location picker —
 * would crash on load. Stub the module globally so the surrounding UI renders
 * headlessly; the map's own lifecycle is asserted against dedicated spies in
 * `IncidentMapView.test.tsx`, which overrides this with its own factory.
 * (CRIS-13/CRIS-54, ADR-0025; docs/conventions.md → Testing.)
 *
 * The surface mirrors what `IncidentMapView` actually calls, including the
 * source/layer API added with the CRIS-54 incident overlay. A missing method
 * here surfaces as an opaque "not a function" inside a `load` handler, so keep
 * this in step when the map gains a call.
 */
vi.mock('maplibre-gl', () => {
  const canvas = { style: {} as Record<string, string> };
  return {
    default: {
      Map: vi.fn(() => ({
        addControl: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        remove: vi.fn(),
        addSource: vi.fn(),
        addLayer: vi.fn(),
        getSource: vi.fn(() => ({ setData: vi.fn(), getClusterExpansionZoom: vi.fn() })),
        getLayer: vi.fn(),
        setFilter: vi.fn(),
        setPaintProperty: vi.fn(),
        getCanvas: vi.fn(() => canvas),
        easeTo: vi.fn(),
        flyTo: vi.fn(),
        getZoom: vi.fn(() => 3),
      })),
      Marker: vi.fn(() => ({
        setLngLat: vi.fn().mockReturnThis(),
        addTo: vi.fn().mockReturnThis(),
        on: vi.fn().mockReturnThis(),
        remove: vi.fn(),
        getLngLat: vi.fn(() => ({ lng: 0, lat: 0 })),
      })),
      NavigationControl: vi.fn(),
    },
  };
});
