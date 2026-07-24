import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no WebGL; maplibre-gl throws on import outside a real browser.
// See __mocks__/maplibre-gl.ts.
vi.mock('maplibre-gl');

import { LocationPicker } from './LocationPicker';

describe('LocationPicker', () => {
  const getCurrentPosition = vi.fn();

  beforeEach(() => {
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
        coords: { latitude: 41.0082, longitude: 28.9784 },
      } as GeolocationPosition);
    });
    const onChange = vi.fn();
    render(<LocationPicker value={null} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /use my location/i }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ lat: 41.0082, lng: 28.9784 }));
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
    render(<LocationPicker value={{ lat: 41.0082, lng: 28.9784 }} onChange={onChange} />);

    expect(screen.getByText(/41\.00820, 28\.97840/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
