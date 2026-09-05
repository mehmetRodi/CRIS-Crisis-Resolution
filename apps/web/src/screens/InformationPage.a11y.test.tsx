import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { InformationPage } from './InformationPage';

describe('Information pages', () => {
  it.each(['about', 'help', 'privacy', 'terms'] as const)(
    'makes %s readable with working navigation',
    (kind) => {
      render(
        <MemoryRouter>
          <InformationPage kind={kind} />
        </MemoryRouter>,
      );
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('main')).toBeInTheDocument();
      expect(screen.getByRole('navigation', { name: 'Information' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'New report' })).toHaveAttribute('href', '/report');
      expect(screen.getByRole('link', { name: 'Terms of use' })).toHaveAttribute('href', '/terms');
    },
  );
});
