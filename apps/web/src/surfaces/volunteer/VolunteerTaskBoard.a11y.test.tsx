import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { VolunteerTaskBoard } from './VolunteerTaskBoard';

describe('VolunteerTaskBoard accessibility', () => {
  it('programmatically labels every filter control', () => {
    render(<VolunteerTaskBoard onExit={() => {}} feed={{ status: 'ready', tasks: [] }} />);

    expect(screen.getByLabelText('Region')).toBeInTheDocument();
    expect(screen.getByLabelText('Category')).toBeInTheDocument();
    expect(screen.getByLabelText('Urgency')).toBeInTheDocument();
  });

  it('exposes each workflow lane as a named region', () => {
    render(<VolunteerTaskBoard onExit={() => {}} feed={{ status: 'ready', tasks: [] }} />);

    for (const name of ['New', 'Assigned', 'In progress', 'Verification needed', 'Completed']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
  });

  it('announces loading, authentication, and error states', () => {
    const { rerender } = render(
      <VolunteerTaskBoard onExit={() => {}} feed={{ status: 'loading' }} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/loading volunteer tasks/i);

    rerender(<VolunteerTaskBoard onExit={() => {}} feed={{ status: 'unauthenticated' }} />);
    expect(screen.getByRole('status')).toHaveTextContent(/sign in as a volunteer/i);

    rerender(
      <VolunteerTaskBoard onExit={() => {}} feed={{ status: 'error', message: 'Read failed' }} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Read failed');
  });
});
