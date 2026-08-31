import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PriorityBand } from '@crisismap/shared';

import { EMPTY_FILTERS, type IncidentFilters } from '../coordinator/incidents';
import { IncidentQueuePanel } from './IncidentQueuePanel';
import { coordinatorIncident } from './testFixtures';

/**
 * The priority queue (CRIS-54).
 *
 * The property that matters most here is that an EMPTY feed and a
 * FILTERED-TO-EMPTY feed never look the same. Conflating them lets a
 * coordinator conclude a region is quiet when they simply left a facet on —
 * the most consequential thing this panel can get wrong.
 */
function renderPanel(overrides: Partial<Parameters<typeof IncidentQueuePanel>[0]> = {}) {
  const props = {
    feed: { status: 'ready' as const, incidents: [coordinatorIncident()] },
    filters: EMPTY_FILTERS,
    onFiltersChange: vi.fn(),
    query: '',
    onQueryChange: vi.fn(),
    sort: 'priority' as const,
    onSortChange: vi.fn(),
    regions: ['kadikoy'],
    selectedId: null,
    onSelect: vi.fn(),
    ...overrides,
  };
  render(<IncidentQueuePanel {...props} />);
  return props;
}

afterEach(cleanup);

describe('IncidentQueuePanel', () => {
  it('distinguishes an empty feed from a feed hidden by filters', () => {
    renderPanel({ feed: { status: 'ready', incidents: [] } });
    expect(screen.getByText(/no incidents yet/i)).toBeInTheDocument();

    cleanup();

    renderPanel({ query: 'nothing matches this' });
    expect(screen.getByText(/no incidents match/i)).toBeInTheDocument();
    // And it offers the way out, so the user is not left guessing why.
    expect(screen.getByRole('button', { name: /clear search and filters/i })).toBeInTheDocument();
  });

  it('reports a failed read as an error, never as "no incidents"', () => {
    renderPanel({ feed: { status: 'error', message: 'Network unreachable' } });
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(/couldn.t load incidents/i)).toBeInTheDocument();
    expect(within(alert).getByText(/network unreachable/i)).toBeInTheDocument();
    expect(screen.queryByText(/no incidents yet/i)).not.toBeInTheDocument();
  });

  it('asks for a sign-in rather than erroring when there is no session', () => {
    renderPanel({ feed: { status: 'unauthenticated' } });
    expect(screen.getByText(/sign in to load incidents/i)).toBeInTheDocument();
  });

  it('renders each incident as one keyboard-reachable control', () => {
    // The map is pointer-only by nature, so this list is the accessible
    // equivalent — every incident must be a single focus stop with one action.
    const props = renderPanel();
    const row = screen.getByRole('button', { name: /stairwell fire/i });
    fireEvent.click(row);
    expect(props.onSelect).toHaveBeenCalledWith('r1');
  });

  it('marks the selected incident with aria-current', () => {
    renderPanel({ selectedId: 'r1' });
    expect(screen.getByRole('button', { name: /stairwell fire/i })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('turns a band count into a filter for that band', () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /^P0/ }));
    expect(props.onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ priorityBands: [PriorityBand.P0] }),
    );
  });

  it('shows how much of the feed is hidden while narrowed', () => {
    renderPanel({
      feed: {
        status: 'ready',
        incidents: [
          coordinatorIncident(),
          coordinatorIncident({ reportId: 'r2', summary: 'Flood' }),
        ],
      },
      query: 'stairwell',
    });
    expect(screen.getByText(/1 of 2 shown/i)).toBeInTheDocument();
  });

  it('flags unscored reports so they are not mistaken for a quiet queue', () => {
    renderPanel({
      feed: {
        status: 'ready',
        incidents: [coordinatorIncident({ priorityBand: null, priorityScore: null })],
      },
    });
    expect(screen.getByText(/awaiting classification/i)).toBeInTheDocument();
  });

  it('announces the loading state instead of leaving skeletons unlabelled', () => {
    renderPanel({ feed: { status: 'loading' } });
    expect(screen.getByRole('status')).toHaveTextContent(/loading incidents/i);
  });

  it('reflects the active sort with aria-pressed rather than colour alone', () => {
    const props = renderPanel({ sort: 'recent' });
    expect(screen.getByRole('button', { name: 'Newest' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Priority' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Priority' }));
    expect(props.onSortChange).toHaveBeenCalledWith('priority');
  });

  it('surfaces the number of active facets on the filter trigger', () => {
    // An active filter must never be invisible: an empty queue has to be
    // distinguishable from a filtered one without opening anything.
    const filters: IncidentFilters = {
      ...EMPTY_FILTERS,
      statuses: ['VERIFIED'],
      regionIds: ['kadikoy'],
    };
    renderPanel({ filters });
    expect(screen.getByLabelText(/2 filters active/i)).toBeInTheDocument();
  });
});
