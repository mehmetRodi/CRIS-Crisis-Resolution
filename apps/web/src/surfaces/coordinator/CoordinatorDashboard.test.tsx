import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Category, PriorityBand, ReportEventType } from '@crisismap/shared';
// The "Live map" region now mounts a real MapLibre map (CRIS-13); MapLibre is
// stubbed globally in vitest.setup.ts (WebGL is absent in jsdom).
import { CoordinatorDashboard } from './CoordinatorDashboard';
import type { CoordinatorIncident, IncidentFeedState, IncidentTimelineState } from './incidents';

function incident(overrides: Partial<CoordinatorIncident> = {}): CoordinatorIncident {
  return {
    reportId: 'report-0001',
    status: 'AI_CLASSIFIED',
    category: Category.MEDICAL,
    urgency: 'HIGH',
    priorityScore: 7,
    priorityBand: PriorityBand.P1,
    summary: null,
    lat: null,
    lng: null,
    geohash: null,
    geohashPrefix: null,
    regionId: 'region-a',
    createdAt: '2026-07-15T10:00:00Z',
    updatedAt: null,
    version: 2,
    confidence: null,
    scoreVersion: null,
    scoreBreakdown: null,
    entities: null,
    ...overrides,
  };
}

describe('CoordinatorDashboard shell', () => {
  it('renders the dashboard heading and coordinator role', () => {
    render(<CoordinatorDashboard onExit={() => {}} />);
    expect(
      screen.getByRole('heading', { level: 1, name: /coordinator dashboard/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('COORDINATOR')).toBeInTheDocument();
  });

  it('renders a metric tile for every priority band', () => {
    render(<CoordinatorDashboard onExit={() => {}} />);
    for (const band of Object.values(PriorityBand)) {
      expect(screen.getByText(band)).toBeInTheDocument();
    }
  });

  it('lays out the named regions from the design-doc interaction map', () => {
    render(<CoordinatorDashboard onExit={() => {}} />);
    for (const region of [
      'Filters',
      'Live map',
      'Priority incident queue',
      'Incident detail',
      'Recent activity',
      'Category distribution',
    ]) {
      expect(screen.getByRole('heading', { name: region })).toBeInTheDocument();
    }
  });

  it('marks the shell as pre-wired: live updates disconnected and actions disabled', () => {
    render(<CoordinatorDashboard onExit={() => {}} />);
    expect(screen.getByText(/live updates: not connected/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();
  });

  it('calls onExit when the overview button is pressed', () => {
    const onExit = vi.fn();
    render(<CoordinatorDashboard onExit={onExit} />);
    fireEvent.click(screen.getByRole('button', { name: /overview/i }));
    expect(onExit).toHaveBeenCalledOnce();
  });
});

describe('CoordinatorDashboard live feed', () => {
  it('renders a sign-in prompt (not an error) when unauthenticated', () => {
    const feed: IncidentFeedState = { status: 'unauthenticated' };
    render(<CoordinatorDashboard onExit={() => {}} feed={feed} />);
    expect(screen.getAllByText(/sign in as a coordinator/i).length).toBeGreaterThan(0);
  });

  it('shows a message when the read fails', () => {
    const feed: IncidentFeedState = { status: 'error', message: 'Network down' };
    render(<CoordinatorDashboard onExit={() => {}} feed={feed} />);
    // The failure surfaces in every data-driven region (queue + distribution).
    expect(screen.getAllByText(/network down/i).length).toBeGreaterThan(0);
  });

  it('tallies live incidents into the priority band tiles', () => {
    const feed: IncidentFeedState = {
      status: 'ready',
      incidents: [
        incident({ reportId: 'a', priorityBand: PriorityBand.P0 }),
        incident({ reportId: 'b', priorityBand: PriorityBand.P0 }),
        incident({ reportId: 'c', priorityBand: PriorityBand.P1 }),
      ],
    };
    render(<CoordinatorDashboard onExit={() => {}} feed={feed} />);
    // P0 tile shows a count of 2 (scoped to the metrics strip — P0 also appears
    // as a band chip in the queue rows).
    const metrics = screen.getByRole('region', { name: /incident metrics/i });
    const p0Tile = within(metrics).getByText('P0').closest('div')?.parentElement as HTMLElement;
    expect(within(p0Tile).getByText('2')).toBeInTheDocument();
    expect(screen.getByText(/3 incidents loaded/i)).toBeInTheDocument();
  });

  it('renders queue rows ordered by priority, highest first', () => {
    const feed: IncidentFeedState = {
      status: 'ready',
      incidents: [
        incident({ reportId: 'low-pri', priorityScore: 2, priorityBand: PriorityBand.P3 }),
        incident({ reportId: 'high-pri', priorityScore: 9, priorityBand: PriorityBand.P0 }),
      ],
    };
    render(<CoordinatorDashboard onExit={() => {}} feed={feed} />);
    const rows = screen.getAllByText(/-pri/).map((el) => el.textContent);
    expect(rows[0]).toContain('high-pri');
  });

  it('shows an empty state when there are no incidents', () => {
    const feed: IncidentFeedState = { status: 'ready', incidents: [] };
    render(<CoordinatorDashboard onExit={() => {}} feed={feed} />);
    expect(screen.getAllByText(/no incidents yet/i).length).toBeGreaterThan(0);
  });

  it('invokes onRefresh when the refresh button is pressed', () => {
    const onRefresh = vi.fn();
    const feed: IncidentFeedState = { status: 'ready', incidents: [] };
    render(<CoordinatorDashboard onExit={() => {}} feed={feed} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});

describe('CoordinatorDashboard filters (CRIS-22)', () => {
  const feed: IncidentFeedState = {
    status: 'ready',
    incidents: [
      incident({ reportId: 'fire-1', category: Category.FIRE, regionId: 'region-a' }),
      incident({ reportId: 'flood-1', category: Category.FLOOD, regionId: 'region-b' }),
    ],
  };

  const filters = () => screen.getByRole('region', { name: /filters/i });
  const queue = () => screen.getByRole('region', { name: /priority incident queue/i });

  it('narrows the queue when a category facet is toggled', () => {
    render(<CoordinatorDashboard onExit={() => {}} feed={feed} />);
    expect(within(queue()).getByText('fire-1')).toBeInTheDocument();
    expect(within(queue()).getByText('flood-1')).toBeInTheDocument();

    fireEvent.click(within(filters()).getByRole('button', { name: 'FIRE' }));

    expect(within(queue()).getByText('fire-1')).toBeInTheDocument();
    expect(within(queue()).queryByText('flood-1')).not.toBeInTheDocument();
    expect(within(queue()).getByText(/showing 1 of 2/i)).toBeInTheDocument();
  });

  it('reflects facet selection via aria-pressed', () => {
    render(<CoordinatorDashboard onExit={() => {}} feed={feed} />);
    expect(within(filters()).getByRole('button', { name: 'FIRE' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    fireEvent.click(within(filters()).getByRole('button', { name: 'FIRE' }));
    expect(within(filters()).getByRole('button', { name: 'FIRE' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('offers only regions present in the feed and filters by region', () => {
    render(<CoordinatorDashboard onExit={() => {}} feed={feed} />);
    expect(within(filters()).getByRole('button', { name: 'region-a' })).toBeInTheDocument();
    expect(within(filters()).getByRole('button', { name: 'region-b' })).toBeInTheDocument();

    fireEvent.click(within(filters()).getByRole('button', { name: 'region-a' }));
    expect(within(queue()).getByText('fire-1')).toBeInTheDocument();
    expect(within(queue()).queryByText('flood-1')).not.toBeInTheDocument();
  });

  it('shows a filter-specific empty state when nothing matches', () => {
    render(<CoordinatorDashboard onExit={() => {}} feed={feed} />);
    fireEvent.click(within(filters()).getByRole('button', { name: 'HAZMAT' }));
    expect(
      within(queue()).getByText(/no incidents match the current filters/i),
    ).toBeInTheDocument();
  });

  it('restores the full queue when filters are cleared', () => {
    render(<CoordinatorDashboard onExit={() => {}} feed={feed} />);
    fireEvent.click(within(filters()).getByRole('button', { name: 'FIRE' }));
    expect(within(queue()).queryByText('flood-1')).not.toBeInTheDocument();

    fireEvent.click(within(filters()).getByRole('button', { name: /clear filters/i }));
    expect(within(queue()).getByText('flood-1')).toBeInTheDocument();
  });
});

describe('CoordinatorDashboard status transitions (CRIS-18)', () => {
  const readyFeed: IncidentFeedState = {
    status: 'ready',
    incidents: [incident({ reportId: 'report-abc', status: 'AI_CLASSIFIED', version: 3 })],
  };

  it('offers only the transitions a coordinator may drive from the current status', () => {
    render(<CoordinatorDashboard onExit={() => {}} feed={readyFeed} onTransition={() => {}} />);
    // Select the incident to open the detail panel.
    fireEvent.click(screen.getByText(/report-a/));
    const detail = screen.getByRole('region', { name: /incident detail/i });
    // AI_CLASSIFIED → VERIFIED / NEEDS_VERIFICATION / REJECTED are coordinator moves.
    expect(within(detail).getByRole('button', { name: 'Verify' })).toBeEnabled();
    expect(within(detail).getByRole('button', { name: 'Reject' })).toBeEnabled();
    expect(within(detail).getByRole('button', { name: /send to verification/i })).toBeEnabled();
    // Not reachable from AI_CLASSIFIED.
    expect(within(detail).queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
  });

  it('calls onTransition with the target status, expected version, and note', () => {
    const onTransition = vi.fn();
    render(<CoordinatorDashboard onExit={() => {}} feed={readyFeed} onTransition={onTransition} />);
    fireEvent.click(screen.getByText(/report-a/));
    const detail = screen.getByRole('region', { name: /incident detail/i });
    fireEvent.change(within(detail).getByPlaceholderText(/reason recorded/i), {
      target: { value: 'corroborated by responder' },
    });
    fireEvent.click(within(detail).getByRole('button', { name: 'Verify' }));
    expect(onTransition).toHaveBeenCalledWith({
      reportId: 'report-abc',
      toStatus: 'VERIFIED',
      expectedVersion: 3,
      note: 'corroborated by responder',
    });
  });

  it('surfaces a CONFLICT with a refresh hint', () => {
    render(
      <CoordinatorDashboard
        onExit={() => {}}
        feed={readyFeed}
        onTransition={() => {}}
        transition={{
          status: 'error',
          reportId: 'report-abc',
          toStatus: 'VERIFIED',
          code: 'CONFLICT',
          message: 'refetch and retry.',
        }}
      />,
    );
    fireEvent.click(screen.getByText(/report-a/));
    expect(screen.getByRole('alert')).toHaveTextContent(/refresh and try again/i);
  });

  it('keeps actions disabled when no transition handler is wired', () => {
    render(<CoordinatorDashboard onExit={() => {}} feed={readyFeed} />);
    fireEvent.click(screen.getByText(/report-a/));
    // Without onTransition the detail panel shows the read-only detail plus the
    // disabled action placeholders (live transitions arrive with onTransition).
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();
  });
});

describe('CoordinatorDashboard incident detail (CRIS-23)', () => {
  const detail = () => screen.getByRole('region', { name: /incident detail/i });

  function renderSelected(
    overrides: Partial<CoordinatorIncident> = {},
    props: { timeline?: IncidentTimelineState } = {},
  ) {
    const feed: IncidentFeedState = {
      status: 'ready',
      incidents: [incident({ reportId: 'report-detail', ...overrides })],
    };
    render(
      <CoordinatorDashboard
        onExit={() => {}}
        feed={feed}
        onTransition={() => {}}
        timeline={props.timeline}
      />,
    );
    fireEvent.click(screen.getByText(/report-d/));
  }

  it('shows the classification snapshot with confidence as a percentage', () => {
    renderSelected({ category: Category.MEDICAL, urgency: 'HIGH', confidence: 0.8 });
    expect(within(detail()).getByText('MEDICAL')).toBeInTheDocument();
    expect(within(detail()).getByText('HIGH')).toBeInTheDocument();
    expect(within(detail()).getByText('80%')).toBeInTheDocument();
  });

  it('renders the explainable score breakdown factors', () => {
    renderSelected({
      scoreBreakdown: {
        urgencyWeight: 4,
        categoryWeight: 1.9,
        affectedPeopleWeight: 0.75,
        verificationWeight: 0.5,
        recencyWeight: 0.8,
        duplicateWeight: 0.75,
        uncertaintyPenalty: 0.25,
        stalenessPenalty: 0,
      },
    });
    expect(within(detail()).getByText(/why this priority/i)).toBeInTheDocument();
    expect(within(detail()).getByText('Duplicate corroboration')).toBeInTheDocument();
    expect(within(detail()).getByText('Affected people')).toBeInTheDocument();
    expect(within(detail()).getByText('Recency')).toBeInTheDocument();
    expect(within(detail()).getByText('+4.00')).toBeInTheDocument();
    expect(within(detail()).getByText('−0.25')).toBeInTheDocument();
  });

  it('surfaces uncertainty and staleness as subtractive penalties', () => {
    renderSelected({
      scoreBreakdown: {
        urgencyWeight: 2,
        categoryWeight: 1,
        affectedPeopleWeight: 0,
        verificationWeight: 0,
        recencyWeight: 0,
        duplicateWeight: 0,
        uncertaintyPenalty: 1,
        stalenessPenalty: 1.5,
      },
    });
    expect(within(detail()).getByText('Uncertainty')).toBeInTheDocument();
    expect(within(detail()).getByText('Staleness')).toBeInTheDocument();
    expect(within(detail()).getByText('−1.50')).toBeInTheDocument();
  });

  it('renders extracted entities (people affected, infrastructure, hazards)', () => {
    renderSelected({
      entities: {
        peopleAffected: 12,
        infrastructure: ['north bridge'],
        hazards: ['gas leak'],
      },
    });
    expect(within(detail()).getByText('12')).toBeInTheDocument();
    expect(within(detail()).getByText('north bridge')).toBeInTheDocument();
    expect(within(detail()).getByText('gas leak')).toBeInTheDocument();
  });

  it('renders the audit timeline newest-first with actor and note', () => {
    const timeline: IncidentTimelineState = {
      status: 'ready',
      events: [
        {
          eventId: 'evt-2',
          type: ReportEventType.STATUS_CHANGED,
          fromStatus: 'AI_CLASSIFIED',
          toStatus: 'VERIFIED',
          actorRole: 'COORDINATOR',
          isSystem: false,
          note: 'confirmed by field team',
          version: 3,
          createdAt: '2026-07-15T11:00:00Z',
        },
        {
          eventId: 'evt-1',
          type: ReportEventType.SUBMITTED,
          fromStatus: null,
          toStatus: 'NEW',
          actorRole: null,
          isSystem: true,
          note: null,
          version: 1,
          createdAt: '2026-07-15T10:00:00Z',
        },
      ],
    };
    renderSelected({}, { timeline });
    expect(within(detail()).getByText(/AI_CLASSIFIED → VERIFIED/)).toBeInTheDocument();
    expect(within(detail()).getByText('COORDINATOR')).toBeInTheDocument();
    expect(within(detail()).getByText(/confirmed by field team/)).toBeInTheDocument();
    expect(within(detail()).getByText(/report submitted/i)).toBeInTheDocument();
    expect(within(detail()).getByText('System')).toBeInTheDocument();
  });

  it('shows a loading state while the timeline is in flight', () => {
    renderSelected({}, { timeline: { status: 'loading' } });
    expect(within(detail()).getByText(/loading timeline/i)).toBeInTheDocument();
  });

  it('surfaces a timeline read error', () => {
    renderSelected({}, { timeline: { status: 'error', message: 'timeline unavailable' } });
    expect(within(detail()).getByText(/timeline unavailable/i)).toBeInTheDocument();
  });

  it('notifies the parent of the selected incident', () => {
    const onSelectIncident = vi.fn();
    const feed: IncidentFeedState = {
      status: 'ready',
      incidents: [incident({ reportId: 'report-detail' })],
    };
    render(
      <CoordinatorDashboard onExit={() => {}} feed={feed} onSelectIncident={onSelectIncident} />,
    );
    fireEvent.click(screen.getByText(/report-d/));
    expect(onSelectIncident).toHaveBeenCalledWith('report-detail');
  });
});
