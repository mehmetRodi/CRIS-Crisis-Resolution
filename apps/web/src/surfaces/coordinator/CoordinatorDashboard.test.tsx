import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Category, PriorityBand, type PublicReport } from '@crisismap/shared';
import { CoordinatorDashboard } from './CoordinatorDashboard';
import type { IncidentFeedState } from './incidents';

function incident(overrides: Partial<PublicReport> = {}): PublicReport {
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
