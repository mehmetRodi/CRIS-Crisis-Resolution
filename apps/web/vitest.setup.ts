import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// MapLibre GL requires a WebGL context and calls `URL.createObjectURL` at import
// time, neither of which jsdom provides. Any test whose module graph includes the
// base map (IncidentMap, the coordinator dashboard, the App landing) would crash on
// load. Stub the module globally so the surrounding UI renders headlessly; the map's
// own lifecycle is asserted against dedicated spies in IncidentMap.test.tsx, which
// overrides this with its own factory. (CRIS-13, ADR-0023; docs/conventions.md → Testing.)
vi.mock('maplibre-gl', () => ({
  default: {
    Map: vi.fn(() => ({
      addControl: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      remove: vi.fn(),
    })),
    NavigationControl: vi.fn(),
  },
}));
