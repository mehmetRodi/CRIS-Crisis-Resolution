import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('maplibre-gl');

import { LocationPicker } from './LocationPicker';

/**
 * The lazy boundary (CRIS-54, ADR-0025).
 *
 * The picker's own behaviour is covered against the inner component; what this
 * pins is the split itself. The report form is the surface most likely to be
 * opened on a degraded network during a disaster, and it must not block on a
 * ~200 kB WebGL engine before its first paint.
 */
describe('LocationPicker lazy boundary', () => {
  it('renders a labelled placeholder while the map chunk streams in', () => {
    render(<LocationPicker value={null} onChange={() => {}} />);
    // Announced, not silent: on a slow connection this is on screen for
    // seconds and is otherwise indistinguishable from a map that failed.
    expect(screen.getByRole('status')).toHaveTextContent(/loading map/i);
  });

  it('eventually renders the real picker', async () => {
    render(<LocationPicker value={null} onChange={() => {}} />);
    expect(await screen.findByRole('application', { name: /location map/i })).toBeInTheDocument();
  });
});
