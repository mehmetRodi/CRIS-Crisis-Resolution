import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Category,
  PriorityBand,
  ReportStatus,
  Urgency,
  VolunteerBoardColumn,
  type VolunteerTask,
} from '@crisismap/shared';
import { TaskWorkspace } from './TaskWorkspace';
import { coordinatorIncident } from './testFixtures';

vi.mock('../volunteer/useMyReportWork', () => ({
  useMyReportWork: () => ({ status: 'ready', ids: ['r1'], refresh: vi.fn() }),
}));
vi.mock('./ReportWorkPanel', () => ({ ReportWorkPanel: () => null }));

const mocks = vi.hoisted(() => ({ publicFeed: vi.fn(), map: vi.fn(), refresh: vi.fn() }));
vi.mock('../map/usePublicIncidents', () => ({ usePublicIncidents: () => mocks.publicFeed() }));
vi.mock('../map/IncidentMap', () => ({
  IncidentMap: (props: unknown) => {
    mocks.map(props);
    return <div aria-label="Task map" />;
  },
}));
const task: VolunteerTask = {
  reportId: 'r1',
  status: ReportStatus.VERIFIED,
  category: Category.FIRE,
  urgency: Urgency.HIGH,
  priorityScore: 7,
  priorityBand: PriorityBand.P1,
  summary: 'Help at the community centre',
  regionId: 'North',
  createdAt: null,
  assignmentId: null,
  assignmentStatus: null,
  teamId: 'team-a',
  teamName: 'Team Alpha',
  column: VolunteerBoardColumn.ASSIGNED,
};
const tasks = [
  task,
  {
    ...task,
    reportId: 'r2',
    summary: 'Water delivery',
    regionId: 'South',
    teamId: 'team-b',
    teamName: 'Team Bravo',
  },
  {
    ...task,
    reportId: 'r3',
    summary: 'Completed response',
    status: ReportStatus.RESOLVED,
    column: VolunteerBoardColumn.COMPLETED,
  },
];

describe('Volunteer task flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.publicFeed.mockReturnValue({
      state: {
        status: 'ready',
        incidents: [coordinatorIncident({ status: ReportStatus.VERIFIED })],
      },
      refresh: mocks.refresh,
    });
  });
  it('focuses on active tasks and combines team, region, and search filters', () => {
    render(<TaskWorkspace feed={{ status: 'ready', tasks }} />);
    expect(screen.getAllByRole('button', { name: /open task/i })).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'North' } });
    fireEvent.change(screen.getByLabelText('Team'), { target: { value: 'team-a' } });
    expect(screen.getAllByRole('button', { name: /open task/i })).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Search tasks'), { target: { value: 'water' } });
    expect(screen.getByText('No tasks in this view')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all tasks' }));
    expect(screen.getAllByRole('button', { name: /open task/i })).toHaveLength(3);
  });
  it('shows only the caller’s claimed reports in My tasks', () => {
    render(<TaskWorkspace feed={{ status: 'ready', tasks }} />);
    fireEvent.click(screen.getByRole('button', { name: 'My tasks' }));
    expect(screen.getAllByRole('button', { name: /open task/i })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /open task: help/i })).toBeInTheDocument();
  });
  it('opens details and only maps the selected public incident, then restores focus', async () => {
    render(<TaskWorkspace feed={{ status: 'ready', tasks }} />);
    expect(mocks.publicFeed).not.toHaveBeenCalled();
    const trigger = screen.getByRole('button', { name: /open task: help/i });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Help at the community centre');
    expect(mocks.map).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedId: 'r1',
        incidents: [expect.objectContaining({ reportId: 'r1' })],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it('explains unavailable coordinates without rendering an empty map', () => {
    mocks.publicFeed.mockReturnValue({
      state: { status: 'ready', incidents: [] },
      refresh: mocks.refresh,
    });
    render(<TaskWorkspace feed={{ status: 'ready', tasks }} />);
    fireEvent.click(screen.getByRole('button', { name: /open task: help/i }));
    expect(screen.getByText('Location not available yet')).toBeInTheDocument();
    expect(mocks.map).not.toHaveBeenCalled();
  });
  it('offers a retry when the location service fails', () => {
    mocks.publicFeed.mockReturnValue({
      state: { status: 'error', message: 'Connection unavailable.' },
      refresh: mocks.refresh,
    });
    render(<TaskWorkspace feed={{ status: 'ready', tasks }} />);
    fireEvent.click(screen.getByRole('button', { name: /open task: help/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry location' }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it('distinguishes a failed task feed from an empty one', () => {
    render(<TaskWorkspace feed={{ status: 'error', message: 'Connection unavailable.' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load tasks");
    expect(screen.queryByText('No tasks available yet')).not.toBeInTheDocument();
  });
});
