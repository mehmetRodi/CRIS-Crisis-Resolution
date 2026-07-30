import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the submit path so the test never hits the network (mirrors ReportForm.test.tsx).
const submitReport = vi.fn();
vi.mock('../lib/submit-report', () => ({
  submitReport: (...args: unknown[]) => submitReport(...args),
  newClientRequestId: () => 'test-request-id',
}));

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
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription(/description, category, and urgency are required/i);
  });

  it('drops the blocked-submit explanation once the form is complete', () => {
    render(<ReportForm />);
    fillRequired();

    const submit = screen.getByRole('button', { name: /submit report/i });
    expect(submit).toBeEnabled();
    expect(submit).toHaveAccessibleDescription('');
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
