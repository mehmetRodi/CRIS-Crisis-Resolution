import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { UserRole } from '@crisismap/shared';
import { RequireRole } from './RequireRole';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));

vi.mock('./AuthContext', () => ({ useAuth: useAuthMock }));

function renderGuarded() {
  render(
    <MemoryRouter initialEntries={['/coordinator']}>
      <Routes>
        <Route path="/login" element={<div>login page</div>} />
        <Route
          path="/coordinator"
          element={
            <RequireRole allow={[UserRole.COORDINATOR, UserRole.ADMIN]}>
              <div>coordinator dashboard</div>
            </RequireRole>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireRole', () => {
  it('renders nothing while the session is still resolving', () => {
    useAuthMock.mockReturnValue({ loading: true, isAuthenticated: false, highestRole: null });
    renderGuarded();
    expect(screen.queryByText('coordinator dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('login page')).not.toBeInTheDocument();
  });

  it('redirects to /login when there is no session', () => {
    useAuthMock.mockReturnValue({ loading: false, isAuthenticated: false, highestRole: null });
    renderGuarded();
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('shows a not-authorized panel when signed in with an ungated role', () => {
    useAuthMock.mockReturnValue({
      loading: false,
      isAuthenticated: true,
      highestRole: UserRole.CITIZEN,
    });
    renderGuarded();
    expect(
      screen.getByRole('heading', { level: 1, name: /don.t have access/i }),
    ).toBeInTheDocument();
    // The denial names the caller's own role and the roles that would work, so
    // the message is actionable rather than a dead end.
    expect(screen.getByText(/signed in as citizen/i)).toBeInTheDocument();
    expect(screen.queryByText('coordinator dashboard')).not.toBeInTheDocument();
  });

  it('renders the guarded children for an allowed role', () => {
    useAuthMock.mockReturnValue({
      loading: false,
      isAuthenticated: true,
      highestRole: UserRole.COORDINATOR,
    });
    renderGuarded();
    expect(screen.getByText('coordinator dashboard')).toBeInTheDocument();
  });
});
