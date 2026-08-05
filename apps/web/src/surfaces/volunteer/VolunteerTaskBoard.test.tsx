import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssignmentStatus, Category, PriorityBand, ReportStatus, Urgency } from '@crisismap/shared';

import { VolunteerTaskBoard } from './VolunteerTaskBoard';
import { VolunteerBoardColumn, type VolunteerTask, type VolunteerTaskFeedState } from './tasks';

function task(overrides: Partial<VolunteerTask> = {}): VolunteerTask {
  return {
    reportId: 'report-medical',
    status: ReportStatus.AI_CLASSIFIED,
    category: Category.MEDICAL,
    urgency: Urgency.HIGH,
    priorityScore: 8,
    priorityBand: PriorityBand.P0,
    summary: 'Deliver medical supplies',
    regionId: 'north',
    createdAt: '2026-08-01T10:00:00Z',
    assignmentId: 'assignment-1',
    assignmentStatus: AssignmentStatus.ASSIGNED,
    teamId: 'team-a',
    teamName: 'North volunteers',
    column: VolunteerBoardColumn.ASSIGNED,
    ...overrides,
  };
}

const feed: VolunteerTaskFeedState = {
  status: 'ready',
  tasks: [
    task(),
    task({
      reportId: 'report-fire',
      category: Category.FIRE,
      urgency: Urgency.CRITICAL,
      summary: 'Check warehouse fire perimeter',
      regionId: 'south',
      column: VolunteerBoardColumn.IN_PROGRESS,
      assignmentStatus: AssignmentStatus.ON_SCENE,
    }),
  ],
};

describe('VolunteerTaskBoard', () => {
  it('renders all five workflow columns and their task cards', () => {
    render(<VolunteerTaskBoard onExit={() => {}} feed={feed} />);

    for (const heading of ['New', 'Assigned', 'In progress', 'Verification needed', 'Completed']) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    }
    expect(screen.getByText('Deliver medical supplies')).toBeInTheDocument();
    expect(screen.getByText('Check warehouse fire perimeter')).toBeInTheDocument();
  });

  it('filters the board by region, category, and urgency', () => {
    render(<VolunteerTaskBoard onExit={() => {}} feed={feed} />);

    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'north' } });
    expect(screen.getByText('Deliver medical supplies')).toBeInTheDocument();
    expect(screen.queryByText('Check warehouse fire perimeter')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Category'), { target: { value: Category.FIRE } });
    expect(screen.queryByText('Deliver medical supplies')).not.toBeInTheDocument();
    expect(screen.getByText(/0 tasks shown/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(screen.getByText('Check warehouse fire perimeter')).toBeInTheDocument();
  });

  it('places cards in their workflow regions', () => {
    render(<VolunteerTaskBoard onExit={() => {}} feed={feed} />);

    const assigned = screen.getByRole('region', { name: 'Assigned' });
    const active = screen.getByRole('region', { name: 'In progress' });
    expect(within(assigned).getByText('Deliver medical supplies')).toBeInTheDocument();
    expect(within(active).getByText('Check warehouse fire perimeter')).toBeInTheDocument();
  });

  it('calls navigation and refresh handlers', () => {
    const onExit = vi.fn();
    const onRefresh = vi.fn();
    render(<VolunteerTaskBoard onExit={onExit} feed={feed} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole('button', { name: /overview/i }));
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(onExit).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('renders unauthenticated and failed reads distinctly', () => {
    const { rerender } = render(
      <VolunteerTaskBoard onExit={() => {}} feed={{ status: 'unauthenticated' }} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/sign in as a volunteer/i);

    rerender(
      <VolunteerTaskBoard
        onExit={() => {}}
        feed={{ status: 'error', message: 'Regional task service unavailable' }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/regional task service unavailable/i);
  });
});
