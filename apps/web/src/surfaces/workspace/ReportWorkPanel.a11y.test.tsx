import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@crisismap/shared';
import { ReportWorkPanel } from './ReportWorkPanel';
const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock('../../lib/amplify', () => ({
  client: { queries: { getReportWork: mocks.get }, mutations: { updateReportWork: mocks.update } },
}));
const unclaimed = {
  reportId: 'r1',
  version: 0,
  assigneeLabel: null,
  isMine: false,
  canClaim: true,
  canEdit: false,
  updates: [],
};
const claimed = {
  ...unclaimed,
  version: 1,
  assigneeLabel: 'Volunteer',
  isMine: true,
  canClaim: false,
  canEdit: true,
};
describe('Report ownership and progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue({ data: unclaimed });
    mocks.update.mockResolvedValue({ data: claimed });
  });
  it('lets a volunteer claim a report and add an update using the new version', async () => {
    render(<ReportWorkPanel reportId="r1" callerRole={UserRole.VOLUNTEER} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Claim report' }));
    expect(await screen.findByText('You claimed this report.')).toBeInTheDocument();
    expect(mocks.update).toHaveBeenCalledWith({
      reportId: 'r1',
      expectedVersion: 0,
      action: 'CLAIM',
    });
    fireEvent.change(screen.getByLabelText('Progress update'), {
      target: { value: 'Arrived with supplies.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save update' }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenLastCalledWith({
        reportId: 'r1',
        expectedVersion: 1,
        action: 'NOTE',
        note: 'Arrived with supplies.',
      }),
    );
    expect(await screen.findByText('Progress update saved.')).toBeInTheDocument();
  });
  it('offers person assignment only to a coordinator', async () => {
    const { unmount } = render(<ReportWorkPanel reportId="r1" callerRole={UserRole.VOLUNTEER} />);
    await screen.findByRole('button', { name: 'Claim report' });
    expect(screen.queryByLabelText('Assign a person')).not.toBeInTheDocument();
    unmount();
    render(<ReportWorkPanel reportId="r1" callerRole={UserRole.ADMIN} />);
    fireEvent.change(await screen.findByLabelText('Assign a person'), {
      target: { value: 'responder@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Assign person' }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        reportId: 'r1',
        expectedVersion: 0,
        action: 'ASSIGN',
        targetUsername: 'responder@example.test',
      }),
    );
  });
  it('keeps an unsaved note intact after a conflict and offers refresh', async () => {
    mocks.get.mockResolvedValue({ data: claimed });
    mocks.update.mockResolvedValue({
      errors: [{ message: 'CONFLICT: This report changed. Refresh before trying again.' }],
    });
    render(<ReportWorkPanel reportId="r1" callerRole={UserRole.VOLUNTEER} />);
    fireEvent.change(await screen.findByLabelText('Progress update'), {
      target: { value: 'Supplies delivered.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save update' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('CONFLICT'));
    expect(screen.getByLabelText('Progress update')).toHaveValue('Supplies delivered.');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh ownership' }));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Progress update')).toHaveValue('Supplies delivered.');
  });
});
