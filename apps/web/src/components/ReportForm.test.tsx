import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

import { ReportForm } from './ReportForm';

const VALID_TEXT = 'A gas leak is filling the stairwell on Elm Street.';

describe('web ReportForm', () => {
  beforeEach(() => {
    submitReport.mockReset();
    submitReport.mockResolvedValue({ reportId: 'r1', status: 'NEW' });
    uploadReportMedia.mockReset();
    uploadReportMedia.mockResolvedValue('reports/test-request-id/photo.jpg');
  });

  it('keeps submit disabled until required fields are valid', () => {
    render(<ReportForm />);

    const submit = screen.getByRole('button', { name: /submit report/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: VALID_TEXT } });
    fireEvent.click(screen.getByRole('button', { name: /medical/i }));
    fireEvent.click(screen.getByRole('button', { name: /^critical$/i }));

    expect(submit).toBeEnabled();
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
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(uploadReportMedia).toHaveBeenCalledWith(file, 'test-request-id'));
    expect(await screen.findByText(/scene\.jpg/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: VALID_TEXT } });
    fireEvent.click(screen.getByRole('button', { name: /medical/i }));
    fireEvent.click(screen.getByRole('button', { name: /^critical$/i }));
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

    const file = new File(['x'], 'notes.txt', { type: 'text/plain' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(await screen.findByText(/unsupported file type/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: VALID_TEXT } });
    fireEvent.click(screen.getByRole('button', { name: /medical/i }));
    fireEvent.click(screen.getByRole('button', { name: /^critical$/i }));
    fireEvent.click(screen.getByRole('button', { name: /submit report/i }));

    await waitFor(() => expect(submitReport).toHaveBeenCalledTimes(1));
    const [submission] = submitReport.mock.calls[0] ?? [];
    expect(submission.mediaKeys).toEqual([]);
  });
});
