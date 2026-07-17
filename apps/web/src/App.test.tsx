import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './AuthContext';

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
});
