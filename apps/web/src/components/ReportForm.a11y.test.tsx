import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the submit path so the test never hits the network (mirrors ReportForm.test.tsx).
const submitReport = vi.fn();
vi.mock('../lib/submit-report', () => ({
  submitReport: (...args: unknown[]) => submitReport(...args),
  newClientRequestId: () => 'test-request-id',
}));

// The form embeds the MapLibre LocationPicker (CRIS-16). Mock the package the
// same way ReportForm.test.tsx does: the global stub in vitest.setup.ts has no
// `Marker`, so anything that places a pin would fail there for a reason that has
// nothing to do with accessibility. See __mocks__/maplibre-gl.ts.
vi.mock('maplibre-gl');

import { ReportForm } from './ReportForm';

/**
 * Accessibility contract for the citizen report form (CRIS-27).
 *
 * This is the emergency-fallback surface (ADR-0021) — the one a person uses
 * under stress, possibly one-handed on a phone with a screen reader. These
 * assertions cover what visual QA cannot see: whether required state, the
 * blocked-submit reason, and the post-submit transition are perceivable
 * without sight.
 */

const VALID_TEXT = 'A gas leak is filling the stairwell on Elm Street.';

/** The first chip inside a named `fieldset` group (Category, Urgency). */
function firstOptionIn(groupName: RegExp) {
  return screen.getByRole('group', { name: groupName }).querySelector('button');
}

/** Fills the three required fields, leaving the form submittable. */
function fillRequired() {
  fireEvent.change(screen.getByLabelText(/description/i), { target: { value: VALID_TEXT } });
  fireEvent.click(screen.getByRole('button', { name: /medical/i }));
  fireEvent.click(screen.getByRole('button', { name: /^critical$/i }));
}

describe('ReportForm accessibility', () => {
  beforeEach(() => {
    submitReport.mockReset();
    submitReport.mockResolvedValue({ reportId: 'r1', status: 'NEW' });
  });

  it('names the form so it is reachable as a landmark', () => {
    render(<ReportForm />);

    expect(screen.getByRole('form', { name: /emergency report/i })).toBeInTheDocument();
  });

  it('announces required fields as required rather than by a bare asterisk', () => {
    render(<ReportForm />);

    // The visible "*" is aria-hidden; the accessible name carries the word.
    expect(screen.getByLabelText(/description/i)).toHaveAccessibleName(/\(required\)/i);
    expect(screen.getByLabelText(/description/i)).toHaveAttribute('aria-required', 'true');
  });

  it('associates the character counter with the description field', () => {
    render(<ReportForm />);

    const description = screen.getByLabelText(/description/i);
    expect(description).toHaveAccessibleDescription(/0\/\d+ characters/i);

    fireEvent.change(description, { target: { value: VALID_TEXT } });
    expect(description).toHaveAccessibleDescription(
      new RegExp(`${VALID_TEXT.length}/\\d+ characters`, 'i'),
    );
  });

  it('explains why submit is unavailable while the form is incomplete', () => {
    render(<ReportForm />);

    const submit = screen.getByRole('button', { name: /submit report/i });
    expect(submit).toHaveAttribute('aria-disabled', 'true');
    // Sourced from the shared validator, so it names every outstanding field
    // rather than restating a fixed sentence that could drift from the gate.
    expect(submit).toHaveAccessibleDescription(
      /description must be longer.*choose a category.*choose an urgency/i,
    );
  });

  it('keeps the gated submit focusable so its reason can be heard', () => {
    render(<ReportForm />);

    // The whole point of aria-disabled over disabled (ADR-0037): a `disabled`
    // button leaves the tab order, and a description on a control that cannot
    // be focused is never announced to the person it was written for.
    const submit = screen.getByRole('button', { name: /submit report/i });
    expect(submit).not.toBeDisabled();

    submit.focus();
    expect(submit).toHaveFocus();
  });

  it('sends focus to the first outstanding field when a gated submit is pressed', () => {
    render(<ReportForm />);
    const submit = screen.getByRole('button', { name: /submit report/i });

    // Nothing filled in: the description is what is missing.
    fireEvent.click(submit);
    expect(screen.getByLabelText(/description/i)).toHaveFocus();

    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: VALID_TEXT } });
    fireEvent.click(submit);
    // Category and urgency are chip groups, so focus enters the group at its
    // first option. Queried through the group rather than by chip name, so the
    // assertion does not encode the order of the Category enum.
    expect(firstOptionIn(/category/i)).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: /medical/i }));
    fireEvent.click(submit);
    expect(firstOptionIn(/urgency/i)).toHaveFocus();
  });

  it('drops the blocked-submit explanation once the form is complete', () => {
    render(<ReportForm />);
    fillRequired();

    const submit = screen.getByRole('button', { name: /submit report/i });
    expect(submit).toHaveAttribute('aria-disabled', 'false');
    expect(submit).toHaveAccessibleDescription('');
  });

  it('names the location picker as a group rather than by adjacent text', () => {
    render(<ReportForm />);

    // The picker is several controls plus a map; without a legend its heading is
    // loose text that a screen reader has no reason to tie to them (CRIS-27).
    expect(screen.getByRole('group', { name: /location/i })).toBeInTheDocument();
  });

  it('gives the photo control a name that reflects the current selection', () => {
    render(<ReportForm />);

    expect(screen.getByRole('button', { name: /add a photo/i })).toBeInTheDocument();

    const file = new File(['x'], 'stairwell.png', { type: 'image/png' });
    // The visible control proxies a visually-hidden file input.
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(
      screen.getByRole('button', { name: /change photo, stairwell\.png selected/i }),
    ).toBeInTheDocument();
  });

  it('announces the confirmation and moves focus to it after submitting', async () => {
    render(<ReportForm />);
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: /submit report/i }));

    await waitFor(() => expect(submitReport).toHaveBeenCalledTimes(1));

    // role=status makes the swap audible; focus makes it navigable. Without both,
    // a screen-reader user is stranded on a control that no longer exists.
    const confirmation = await screen.findByRole('status');
    expect(confirmation).toHaveTextContent(/report submitted/i);

    const heading = screen.getByRole('heading', { name: /report submitted/i });
    await waitFor(() => expect(heading).toHaveFocus());
  });
});
