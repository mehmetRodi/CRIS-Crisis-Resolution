import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

// The lazy wrapper streams in the heavy MapLibre view on demand. `maplibre-gl` is
// stubbed globally in vitest.setup.ts (WebGL is absent in jsdom).
import { IncidentMap } from './IncidentMap';

afterEach(cleanup);

describe('IncidentMap (lazy boundary)', () => {
  it('shows a loading placeholder, then resolves the map view', async () => {
    render(<IncidentMap className="h-40" />);
    // Suspense fallback renders synchronously before the chunk resolves.
    expect(screen.getByText(/loading map/i)).toBeInTheDocument();
    // Once the lazy chunk loads, the accessible map region appears.
    expect(await screen.findByRole('application', { name: /incident map/i })).toBeInTheDocument();
  });
});
