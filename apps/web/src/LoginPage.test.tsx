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

  it('sends a completed sign-in to the workspace, not the public home page', async () => {
    signInMock.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
    renderLogin();
    // `/workspace` then routes on to the pane this role actually works from
    // (ADR-0055). Landing on `/` would put a public homepage between a
    // responder and the incident they were paged about. `replace` keeps Back
    // from returning to the sign-in form they just completed.
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/workspace', { replace: true }));
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
    // Cognito carries the fault on `name`, not in the message — asserting on a
    // message-only error would keep passing even if the branch stopped matching.
    const err = new Error('Incorrect username or password.');
    err.name = 'NotAuthorizedException';
    signInMock.mockRejectedValue(err);
    renderLogin();
    expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('clears a stale session and retries rather than reporting bad credentials', async () => {
    // Amplify refuses to sign in over an existing session instead of replacing
    // it. Reporting that as a password failure sends the user to reset a
    // password that was never wrong, which is the bug this branch exists for.
    const err = new Error('There is already a signed in user.');
    err.name = 'UserAlreadyAuthenticatedException';
    signInMock
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
    renderLogin();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/workspace', { replace: true }));
    expect(signInMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces an unexpected failure instead of disguising it as bad credentials', async () => {
    // A configuration or service fault has a different remedy than a wrong
    // password, so it must not be collapsed into the credentials message.
    signInMock.mockRejectedValue(new Error('User pool client does not exist.'));
    renderLogin();
    expect(await screen.findByText(/user pool client does not exist/i)).toBeInTheDocument();
    expect(screen.queryByText(/invalid email or password/i)).not.toBeInTheDocument();
  });
});
