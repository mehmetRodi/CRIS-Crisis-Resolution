import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportStatus, UserRole } from '@crisismap/shared';

// Ownership actions have their own interaction and authorization coverage.
vi.mock('./ReportWorkPanel', () => ({ ReportWorkPanel: () => null }));
vi.mock('./CreateTeamAction', () => ({ CreateTeamAction: () => null }));

import { capabilitiesFor } from '../../lib/capabilities';
import { IncidentDetailPanel } from './IncidentDetailPanel';
import { coordinatorIncident } from './testFixtures';

/**
 * The incident-detail rail (CRIS-23 → CRIS-54).
 *
 * These tests are chiefly about what each ROLE is offered. A control that is
 * shown and then refused by the server reads as a broken product, and a
 * disabled control is a promise of access that a volunteer will never have —
 * so the rail omits actions rather than disabling them.
 */
function renderPanel(overrides: Partial<Parameters<typeof IncidentDetailPanel>[0]> = {}) {
  const props = {
    incident: coordinatorIncident(),
    timeline: { status: 'idle' as const },
    capabilities: capabilitiesFor(UserRole.COORDINATOR),
    callerRole: UserRole.COORDINATOR,
    onClose: vi.fn(),
    onTransition: vi.fn(),
    transition: { status: 'idle' as const },
    onAssignTeam: vi.fn(),
    assignment: { status: 'idle' as const },
    teams: [{ id: 't1', name: 'Alpha Team' }],
    ...overrides,
  };
  render(<IncidentDetailPanel {...props} />);
  return props;
}

afterEach(cleanup);

describe('IncidentDetailPanel', () => {
  it('leads with the AI summary, never the raw report body', () => {
    // `PublicReport` carries no `text` field at all, and this heading is the
    // one place a summary could be confused for the reporter's own words (§5.6).
    renderPanel();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/stairwell fire/i);
  });

  it('says a summary is pending rather than rendering an empty heading', () => {
    renderPanel({ incident: coordinatorIncident({ summary: null }) });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/awaiting ai summary/i);
  });

  it('offers a coordinator both status actions and team assignment', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /verify/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /response team/i })).toBeInTheDocument();
  });

  it('withholds team assignment from a responder while keeping status actions', () => {
    renderPanel({
      capabilities: capabilitiesFor(UserRole.RESPONDER),
      callerRole: UserRole.RESPONDER,
    });
    expect(screen.getByRole('button', { name: /verify/i })).toBeInTheDocument();
    // `assignTeam` is COORDINATOR/ADMIN only.
    expect(screen.queryByRole('combobox', { name: /response team/i })).not.toBeInTheDocument();
    // …and a responder cannot reject.
    expect(screen.queryByRole('button', { name: /^reject$/i })).not.toBeInTheDocument();
  });

  it('shows a volunteer the evidence with no action block at all', () => {
    renderPanel({
      capabilities: capabilitiesFor(UserRole.VOLUNTEER),
      callerRole: UserRole.VOLUNTEER,
    });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/stairwell fire/i);
    expect(screen.queryByRole('button', { name: /verify/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /response team/i })).not.toBeInTheDocument();
    // No timeline either — it rides the staff feed this role cannot read.
    expect(screen.queryByText(/timeline/i)).not.toBeInTheDocument();
  });

  it('explains a stale-version conflict in terms of what to do next', () => {
    renderPanel({
      transition: {
        status: 'error',
        reportId: 'r1',
        toStatus: ReportStatus.VERIFIED,
        code: 'CONFLICT',
        message: 'ConditionalCheckFailedException',
      },
    });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/changed while you had it open/i);
    // The raw resolver error is not what an operator under pressure can act on.
    expect(alert).not.toHaveTextContent(/ConditionalCheckFailedException/);
  });

  it('never shows another incident’s outcome against the one on screen', () => {
    renderPanel({
      transition: {
        status: 'success',
        reportId: 'a-different-report',
        toStatus: ReportStatus.VERIFIED,
        version: 4,
      },
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('passes the optimistic-lock version through with the transition', () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));
    expect(props.onTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        reportId: 'r1',
        toStatus: ReportStatus.VERIFIED,
        expectedVersion: 3,
      }),
    );
  });

  it('says so plainly when no move is available from the current state', () => {
    renderPanel({ incident: coordinatorIncident({ status: ReportStatus.REJECTED }) });
    expect(screen.getByText(/no status actions are available/i)).toBeInTheDocument();
  });

  it('names the already-assigned team instead of offering the picker again', () => {
    renderPanel({ incident: coordinatorIncident({ assignedTeamId: 't1' }) });
    expect(screen.getByText(/alpha team/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /response team/i })).not.toBeInTheDocument();
  });

  it('falls back to the raw team id when the team is not in the loaded list', () => {
    // A deleted or not-yet-loaded team must not render as "Assigned to undefined".
    renderPanel({ incident: coordinatorIncident({ assignedTeamId: 't-unknown' }), teams: [] });
    expect(screen.getByText('t-unknown')).toBeInTheDocument();
  });

  it('shows the report id in full for reading aloud over radio', () => {
    const incident = coordinatorIncident({ reportId: '01JQZX8N4T7R9WQ2F3K5M6P8AB' });
    renderPanel({ incident });
    expect(screen.getByText('01JQZX8N4T7R9WQ2F3K5M6P8AB')).toBeInTheDocument();
  });
});
