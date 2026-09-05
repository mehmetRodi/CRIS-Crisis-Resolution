import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { LandingPage } from './LandingPage';

vi.mock('../AuthContext', () => ({
  useAuth: () => ({ loading: false, isAuthenticated: false, highestRole: null }),
}));

describe('Citizen landing navigation', () => {
  it('gives guests named report, map, and sign-in destinations', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Report an emergency' })).toHaveAttribute(
      'href',
      '/report',
    );
    expect(screen.getByRole('link', { name: 'View incident map' })).toHaveAttribute('href', '/map');
    expect(screen.getByRole('link', { name: 'Staff sign in' })).toHaveAttribute('href', '/login');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const main = screen.getByRole('main');
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      `#${main.id}`,
    );
    expect(main).toHaveAttribute('tabindex', '-1');
  });
});
