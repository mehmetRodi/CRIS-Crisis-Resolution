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
    realtime: 'connected' as const,
    refresh: vi.fn(),
  })),
  useLiveReports: vi.fn(() => ({
    state: { status: 'ready' as const, incidents: [] },
    realtime: 'connected' as const,
    lastUpdate: null,
    refresh: vi.fn(),
  })),
  useIncidentTimeline: vi.fn(() => ({
    state: { status: 'idle' as const },
    refresh: vi.fn(),
  })),
  useReportTransition: vi.fn(() => ({
    state: { status: 'idle' as const },
    transition: vi.fn(),
    reset: vi.fn(),
  })),
}));

vi.mock('./AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => mocks.auth,
}));
vi.mock('./lib/amplify', () => ({ client: {} }));

vi.mock('./surfaces/volunteer/useVolunteerTasks', () => ({
  useVolunteerTasks: mocks.useVolunteerTasks,
}));
vi.mock('./surfaces/coordinator/useLiveReports', () => ({
  useLiveReports: mocks.useLiveReports,
}));
vi.mock('./surfaces/coordinator/useIncidentTimeline', () => ({
  useIncidentTimeline: mocks.useIncidentTimeline,
}));
vi.mock('./surfaces/coordinator/useReportTransition', () => ({
  useReportTransition: mocks.useReportTransition,
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

      // `/volunteer` is a legacy URL that now redirects into the consolidated
      // workspace (ADR-0055); the assertion follows the redirect through to the
      // board it lands on.
      expect(
        screen.getByRole('heading', { level: 1, name: /find where you can help/i }),
      ).toBeInTheDocument();
      expect(mocks.useVolunteerTasks).toHaveBeenCalledOnce();
    },
  );

  it('denies a citizen without mounting the data hook', () => {
    mocks.auth.highestRole = UserRole.CITIZEN;
    window.history.pushState({}, '', '/volunteer');

    render(<Router />);

    expect(
      screen.getByRole('heading', { level: 1, name: /don.t have access/i }),
    ).toBeInTheDocument();
    expect(mocks.useVolunteerTasks).not.toHaveBeenCalled();
  });
});
