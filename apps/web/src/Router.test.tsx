import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@crisismap/shared';
import { Router } from './Router';

const mocks = vi.hoisted(() => ({
  auth: {
    loading: false,
    isAuthenticated: true,
    highestRole: 'VOLUNTEER' as string | null,
  },
  useVolunteerTasks: vi.fn(() => ({
    state: { status: 'ready' as const, tasks: [] },
    refresh: vi.fn(),
  })),
}));

vi.mock('./AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => mocks.auth,
}));

vi.mock('./surfaces/volunteer/useVolunteerTasks', () => ({
  useVolunteerTasks: mocks.useVolunteerTasks,
}));

describe('Router volunteer authorization', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.auth.loading = false;
    mocks.auth.isAuthenticated = true;
    mocks.auth.highestRole = UserRole.VOLUNTEER;
    window.history.pushState({}, '', '/');
  });

  it.each([UserRole.VOLUNTEER, UserRole.RESPONDER, UserRole.COORDINATOR, UserRole.ADMIN])(
    'allows the %s role to open the task board',
    (role) => {
      mocks.auth.highestRole = role;
      window.history.pushState({}, '', '/volunteer');

      render(<Router />);

      expect(
        screen.getByRole('heading', { level: 1, name: /volunteer task board/i }),
      ).toBeInTheDocument();
      expect(mocks.useVolunteerTasks).toHaveBeenCalledOnce();
    },
  );

  it('denies a citizen without mounting the data hook', () => {
    mocks.auth.highestRole = UserRole.CITIZEN;
    window.history.pushState({}, '', '/volunteer');

    render(<Router />);

    expect(screen.getByRole('heading', { name: /not authorized/i })).toBeInTheDocument();
    expect(mocks.useVolunteerTasks).not.toHaveBeenCalled();
  });
});
