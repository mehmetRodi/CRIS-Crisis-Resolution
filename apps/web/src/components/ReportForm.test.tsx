import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the submit path so the test never hits the network. `submitReport`
// resolves; `newClientRequestId` is deterministic.
const submitReport = vi.fn();
vi.mock('../lib/submit-report', () => ({
  submitReport: (...args: unknown[]) => submitReport(...args),
  newClientRequestId: () => 'test-request-id',
}));

// Mock the media upload path (CRIS-17) so the test never hits the network.
const uploadReportMedia = vi.fn();
vi.mock('../lib/media-upload', () => ({
  uploadReportMedia: (...args: unknown[]) => uploadReportMedia(...args),
}));

// jsdom has no WebGL; maplibre-gl throws on import outside a real browser.
// See __mocks__/maplibre-gl.ts.
vi.mock('maplibre-gl');

import { ReportForm } from './ReportForm';

const VALID_TEXT = 'A gas leak is filling the stairwell on Elm Street.';

/**
 * The photo control. Its accessible name tracks upload state (ADR-0037), and its
 * visible text is mirrored into a live region — so photo assertions scope to this
 * element rather than the document, which would match both copies.
 */
function photoControl() {
  return screen.getByRole('button', {
    name: /add a photo|uploading|change photo|retry photo/i,
  });
}

/** Picks a file through the visually-hidden input the photo box proxies. */
function pickFile(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  return input;
}

/** Fills the three required fields, leaving the form submittable. */
function fillRequired(category = /medical/i, urgency = /^critical$/i) {
  fireEvent.change(screen.getByLabelText(/description/i), { target: { value: VALID_TEXT } });
  fireEvent.click(screen.getByRole('button', { name: category }));
  fireEvent.click(screen.getByRole('button', { name: urgency }));
}

describe('web ReportForm', () => {
  beforeEach(() => {
    submitReport.mockReset();
    submitReport.mockResolvedValue({ reportId: 'r1', status: 'NEW' });
    uploadReportMedia.mockReset();
    uploadReportMedia.mockResolvedValue('reports/test-request-id/photo.jpg');
  });

  it('gates submit until required fields are valid', () => {
    render(<ReportForm />);

    // `aria-disabled`, not `disabled` — the button stays focusable so its reason
    // is reachable; `handleSubmit` holds the actual gate (ADR-0037).
    const submit = screen.getByRole('button', { name: /submit report/i });
    expect(submit).toHaveAttribute('aria-disabled', 'true');

    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: VALID_TEXT } });
    fireEvent.click(screen.getByRole('button', { name: /medical/i }));
    fireEvent.click(screen.getByRole('button', { name: /^critical$/i }));

    expect(submit).toHaveAttribute('aria-disabled', 'false');
  });

  it('does not submit an incomplete draft when the gated button is pressed', () => {
    render(<ReportForm />);

    fireEvent.click(screen.getByRole('button', { name: /submit report/i }));

    expect(submitReport).not.toHaveBeenCalled();
  });

  it('submits and shows the confirmation view', async () => {
    render(<ReportForm />);

    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: VALID_TEXT } });
    fireEvent.click(screen.getByRole('button', { name: /fire/i }));
    fireEvent.click(screen.getByRole('button', { name: /^high$/i }));
    fireEvent.click(screen.getByRole('button', { name: /submit report/i }));

    await waitFor(() => expect(submitReport).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/report submitted/i)).toBeInTheDocument();

    const call = submitReport.mock.calls[0] ?? [];
    const [submission, requestId] = call;
    expect(requestId).toBe('test-request-id');
    expect(submission).toMatchObject({ category: 'FIRE', urgency: 'HIGH' });
  });

  it('uploads a picked photo and includes its key in the submission', async () => {
    render(<ReportForm />);

    const file = new File(['x'], 'scene.jpg', { type: 'image/jpeg' });
    pickFile(file);

    await waitFor(() => expect(uploadReportMedia).toHaveBeenCalledWith(file, 'test-request-id'));
    expect(within(photoControl()).getByText(/scene\.jpg/i)).toBeInTheDocument();

    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: /submit report/i }));

    await waitFor(() => expect(submitReport).toHaveBeenCalledTimes(1));
    const [submission] = submitReport.mock.calls[0] ?? [];
    expect(submission.mediaKeys).toEqual(['reports/test-request-id/photo.jpg']);
  });

  it('shows an error but still allows submitting without the photo', async () => {
    // A photo is optional — a failed upload must not block an emergency
    // report, only leave mediaKeys empty.
    uploadReportMedia.mockRejectedValue(new Error('Unsupported file type.'));
    render(<ReportForm />);

    pickFile(new File(['x'], 'notes.txt', { type: 'text/plain' }));

    await waitFor(() =>
      expect(within(photoControl()).getByText(/unsupported file type/i)).toBeInTheDocument(),
    );

    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: /submit report/i }));

    await waitFor(() => expect(submitReport).toHaveBeenCalledTimes(1));
    const [submission] = submitReport.mock.calls[0] ?? [];
    expect(submission.mediaKeys).toEqual([]);
  });

  it('re-uploads when the same file is picked again after a failure', async () => {
    // The file input's `value` has to be cleared on every pick. Otherwise
    // re-selecting the same file is not a `change` at all, the browser fires
    // nothing, and the retry the error message just asked for silently no-ops.
    uploadReportMedia.mockRejectedValueOnce(new Error('The photo upload failed.'));
    render(<ReportForm />);

    const file = new File(['x'], 'scene.jpg', { type: 'image/jpeg' });
    const fileInput = pickFile(file);

    await waitFor(() =>
      expect(within(photoControl()).getByText(/the photo upload failed/i)).toBeInTheDocument(),
    );
    expect(fileInput.value).toBe('');

    uploadReportMedia.mockResolvedValueOnce('reports/test-request-id/retry.jpg');
    pickFile(file);

    await waitFor(() => expect(uploadReportMedia).toHaveBeenCalledTimes(2));
  });

  it('ignores a second pick while an upload is still in flight', async () => {
    // Two concurrent uploads would apply their keys in arrival order, so a slow
    // first upload could attach itself while the form displays the second file.
    // The busy guard prevents the overlap outright.
    uploadReportMedia.mockReturnValue(new Promise<string>(() => {}));
    render(<ReportForm />);

    pickFile(new File(['a'], 'a.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(within(photoControl()).getByText(/a\.jpg/i)).toBeInTheDocument());

    pickFile(new File(['b'], 'b.jpg', { type: 'image/jpeg' }));

    expect(uploadReportMedia).toHaveBeenCalledTimes(1);
    expect(within(photoControl()).getByText(/a\.jpg/i)).toBeInTheDocument();
  });

  it('does not carry a photo across into the next report', async () => {
    // A photo picked while a submit is in flight belongs to no report: the
    // success path resets the draft and retires the clientRequestId its key is
    // scoped to. Letting it land would attach it — invisibly, since the reset
    // clears the filename — to whatever the user files next.
    let finishSubmit: (result: { reportId: string; status: string }) => void = () => {};
    submitReport.mockReturnValueOnce(
      new Promise((resolve) => {
        finishSubmit = resolve;
      }),
    );
    render(<ReportForm />);

    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: /submit report/i }));
    await waitFor(() => expect(submitReport).toHaveBeenCalledTimes(1));

    pickFile(new File(['x'], 'stale.jpg', { type: 'image/jpeg' }));
    finishSubmit({ reportId: 'r1', status: 'NEW' });

    fireEvent.click(await screen.findByRole('button', { name: /submit another report/i }));
    fillRequired(/fire/i, /^high$/i);
    fireEvent.click(screen.getByRole('button', { name: /submit report/i }));

    await waitFor(() => expect(submitReport).toHaveBeenCalledTimes(2));
    const [second] = submitReport.mock.calls[1] ?? [];
    expect(second.mediaKeys).toEqual([]);
  });

  it('tells the user when the report went out without their photo', async () => {
    uploadReportMedia.mockRejectedValue(new Error('The photo upload failed.'));
    render(<ReportForm />);

    pickFile(new File(['x'], 'scene.jpg', { type: 'image/jpeg' }));
    await waitFor(() =>
      expect(within(photoControl()).getByText(/the photo upload failed/i)).toBeInTheDocument(),
    );

    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: /submit report/i }));

    // An unqualified "Report Submitted" would let the user believe the photo
    // went with it.
    expect(await screen.findByText(/sent without it/i)).toBeInTheDocument();
  });
});
