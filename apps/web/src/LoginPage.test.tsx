import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './LoginPage';
import { AuthProvider } from './AuthContext';

// Hoisted so the vi.mock factories below can reference them.
const { navigateMock, signInMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  signInMock: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

// getCurrentUser rejects (guest), so AuthProvider settles unauthenticated.
vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: () => Promise.reject(new Error('not signed in')),
  fetchUserAttributes: () => Promise.resolve({}),
  signIn: signInMock,
  signUp: vi.fn(),
  signOut: vi.fn(),
  confirmSignUp: vi.fn(),
  resendSignUpCode: vi.fn(),
}));

function renderLogin() {
  render(
    <MemoryRouter>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </MemoryRouter>,
  );
  // By label, not by placeholder: a placeholder is a hint, not an accessible
  // name, so querying it would keep passing if the association were dropped
  // (CRIS-27, ADR-0036).
  fireEvent.change(screen.getByLabelText(/^email$/i), {
    target: { value: 'citizen@example.com' },
  });
  fireEvent.change(screen.getByLabelText(/^password$/i), {
    target: { value: 'Passw0rd' },
  });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
}

describe('LoginPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    signInMock.mockReset();
  });

  it('navigates home after a completed sign-in', async () => {
    signInMock.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
    renderLogin();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/'));
  });

  it('sends an unverified account to confirmation via the CONFIRM_SIGN_UP next step', async () => {
    signInMock.mockResolvedValue({
      isSignedIn: false,
      nextStep: { signInStep: 'CONFIRM_SIGN_UP' },
    });
    renderLogin();
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/confirm-signup', {
        state: { email: 'citizen@example.com' },
      }),
    );
  });

  it('sends an unverified account to confirmation when Cognito throws UserNotConfirmedException', async () => {
    const err = new Error('User is not confirmed.');
    err.name = 'UserNotConfirmedException';
    signInMock.mockRejectedValue(err);
    renderLogin();
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/confirm-signup', {
        state: { email: 'citizen@example.com' },
      }),
    );
  });

  it('shows a credentials error and does not navigate on a failed sign-in', async () => {
    signInMock.mockRejectedValue(new Error('NotAuthorizedException'));
    renderLogin();
    expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
