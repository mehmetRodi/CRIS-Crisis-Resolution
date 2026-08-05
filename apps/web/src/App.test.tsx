import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './AuthContext';
import { CoordinatorDashboard } from './surfaces/coordinator/CoordinatorDashboard';
import { VolunteerTaskBoard } from './surfaces/volunteer/VolunteerTaskBoard';

// No signed-in user in these tests; getCurrentUser rejects like it does for a
// guest, so AuthProvider settles with isAuthenticated: false.
vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: () => Promise.reject(new Error('not signed in')),
  fetchUserAttributes: () => Promise.resolve({}),
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  confirmSignUp: vi.fn(),
  resendSignUpCode: vi.fn(),
}));

function renderApp() {
  render(
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>,
  );
  // Flush AuthProvider's checkUser() rejection before asserting, so React
  // doesn't warn about a post-test state update outside act().
  return screen.findByRole('button', { name: /sign in/i });
}

describe('App shell', () => {
  it('renders the product name', async () => {
    await renderApp();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /crisismap ai/i,
      }),
    ).toBeInTheDocument();
  });

  it('lists the placeholder surfaces', async () => {
    await renderApp();
    expect(screen.getByText('Citizen submission')).toBeInTheDocument();
    expect(screen.getByText('Coordinator dashboard')).toBeInTheDocument();
  });

  // CRIS-27: without an explicit label the card's accessible name is its entire
  // contents — title, ticket, description, and role read as one string.
  it('names each navigable card by the action it performs', async () => {
    await renderApp();

    expect(screen.getByRole('button', { name: 'Open Coordinator dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Live map' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Citizen submission' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Volunteer task board' })).toBeInTheDocument();
  });

  it('makes the landed volunteer board keyboard reachable', async () => {
    await renderApp();

    expect(screen.getByRole('button', { name: /volunteer task board/i })).toHaveAttribute(
      'tabindex',
      '0',
    );
  });

  it('navigates to the volunteer task board when its card is activated', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<App />} />
            <Route
              path="/volunteer"
              element={<VolunteerTaskBoard onExit={() => {}} feed={{ status: 'loading' }} />}
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /volunteer task board/i }));
    expect(
      await screen.findByRole('heading', { level: 1, name: /volunteer task board/i }),
    ).toBeInTheDocument();
  });

  it('navigates to the coordinator dashboard shell when its card is activated', async () => {
    // App reads useAuth(), so it must render inside an AuthProvider; the mock
    // above makes it settle unauthenticated.
    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<App />} />
            <Route path="/coordinator" element={<CoordinatorDashboard onExit={() => {}} />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /coordinator dashboard/i }));
    // findBy* awaits pending state, flushing AuthProvider's checkUser() settle
    // so React doesn't warn about an update outside act().
    expect(
      await screen.findByRole('heading', { level: 1, name: /coordinator dashboard/i }),
    ).toBeInTheDocument();
  });
});
