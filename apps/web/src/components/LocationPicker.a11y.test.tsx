import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportLocation } from '@crisismap/shared';

// jsdom has no WebGL; maplibre-gl throws on import outside a real browser.
// See __mocks__/maplibre-gl.ts.
vi.mock('maplibre-gl');

// Imported directly rather than through the `React.lazy` boundary in
// `LocationPicker.tsx` (CRIS-54): these tests assert the picker's own
// behaviour, and going through Suspense would make every one of them async
// for no added coverage. The boundary has its own test.
import LocationPicker from './LocationPickerMap';

/**
 * Accessibility contract for the location picker (CRIS-27, ADR-0037).
 *
 * The picker arrived with CRIS-16 on `/report` — the emergency-fallback surface
 * (ADR-0021) — after the ADR-0036 baseline was written, so it was never held to
 * it. Dropping a pin is inherently a pointer gesture; what these assertions
 * protect is everything around it: that the keyboard paths are named, and that
 * the two outcomes a non-sighted citizen cannot see — a captured fix and a
 * denied permission — are both announced.
 */

const ISTANBUL: ReportLocation = { lat: 41.0082, lng: 28.9784 };

/** Real state, so a captured location actually flows back in as `value`. */
function ControlledPicker({ initial = null }: { initial?: ReportLocation | null }) {
  const [value, setValue] = useState<ReportLocation | null>(initial);
  return <LocationPicker value={value} onChange={setValue} />;
}

describe('LocationPicker accessibility', () => {
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

  it('names the GPS control without reading its decorative pin', () => {
    render(<ControlledPicker />);

    // The 📍 is aria-hidden, so the name is the sentence and not
    // "round pushpin Use my location".
    expect(screen.getByRole('button', { name: /^use my location$/i })).toBeInTheDocument();
  });

  it('names the map region and states what it is for', () => {
    render(<ControlledPicker />);

    expect(screen.getByRole('application', { name: /location map/i })).toBeInTheDocument();
  });

  it('gives the clear control an object', () => {
    render(<ControlledPicker initial={ISTANBUL} />);

    // "Clear" alone is unanswerable when read out of its visual context.
    expect(screen.getByRole('button', { name: /clear selected location/i })).toBeInTheDocument();
  });

  it('marks the GPS control busy while it waits for a fix', () => {
    render(<ControlledPicker />);
    const button = screen.getByRole('button', { name: /^use my location$/i });
    expect(button).toHaveAttribute('aria-busy', 'false');

    button.focus();
    fireEvent.click(button);

    // The visible label switches to "Locating…"; aria-busy is how that reaches
    // someone who cannot see the label change.
    const busy = screen.getByRole('button', { name: /locating/i });
    expect(busy).toHaveAttribute('aria-busy', 'true');

    // And it is aria-disabled rather than disabled, so the person who pressed it
    // keeps their place instead of being dropped to the body (ADR-0037).
    expect(busy).not.toBeDisabled();
    expect(busy).toHaveFocus();
  });

  it('announces a captured location through a live region that already existed', () => {
    render(<ControlledPicker />);

    // Present and populated before anything happens — a region inserted at the
    // same moment as its text is commonly missed (ADR-0037).
    expect(screen.getByRole('status')).toHaveTextContent(/tap the map to drop a pin/i);

    fireEvent.click(screen.getByRole('button', { name: /^use my location$/i }));
    const [onSuccess] = getCurrentPosition.mock.calls[0] ?? [];
    act(() => onSuccess({ coords: { latitude: ISTANBUL.lat, longitude: ISTANBUL.lng } }));

    expect(screen.getByRole('status')).toHaveTextContent(/pin at 41\.00820, 28\.97840/i);
  });

  it('announces a denied location permission instead of failing quietly', () => {
    render(<ControlledPicker />);

    // The alert region is mounted and empty up front, for the same reason.
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole('button', { name: /^use my location$/i }));
    const [, onError] = getCurrentPosition.mock.calls[0] ?? [];
    act(() => onError());

    // A refused permission is the likeliest outcome of that button, and the one
    // most easily mistaken for the app doing nothing.
    expect(screen.getByRole('alert')).toHaveTextContent(/could not get your location/i);
  });

  it('announces an unsupported device rather than leaving the button inert', () => {
    // @ts-expect-error -- simulate a browser without the Geolocation API
    delete navigator.geolocation;
    render(<ControlledPicker />);

    fireEvent.click(screen.getByRole('button', { name: /^use my location$/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/not available on this device/i);
  });
});
