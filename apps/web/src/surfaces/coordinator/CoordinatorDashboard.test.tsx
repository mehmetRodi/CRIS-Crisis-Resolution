import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PriorityBand } from '@crisismap/shared';
// The "Live map" region now mounts a real MapLibre map (CRIS-13); MapLibre is
// stubbed globally in vitest.setup.ts (WebGL is absent in jsdom).
import { CoordinatorDashboard } from './CoordinatorDashboard';

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
