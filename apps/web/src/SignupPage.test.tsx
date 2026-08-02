import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { PASSWORD_RULE_HINT } from '@crisismap/shared';
import SignupPage from './SignupPage';
import { AuthProvider } from './AuthContext';

const { navigateMock, signUpMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  signUpMock: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: () => Promise.reject(new Error('not signed in')),
  fetchUserAttributes: () => Promise.resolve({}),
  signIn: vi.fn(),
  signUp: signUpMock,
  signOut: vi.fn(),
  confirmSignUp: vi.fn(),
  resendSignUpCode: vi.fn(),
}));

function renderSignup() {
  render(
    <MemoryRouter>
      <AuthProvider>
        <SignupPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function fill({ password, confirm }: { password: string; confirm: string }) {
  // By label, not by placeholder — see the note in LoginPage.test.tsx.
  fireEvent.change(screen.getByLabelText(/^email$/i), {
    target: { value: 'citizen@example.com' },
  });
  fireEvent.change(screen.getByLabelText(/^password$/i), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText(/confirm password/i), {
    target: { value: confirm },
  });
  fireEvent.click(screen.getByRole('button', { name: /create account/i }));
}

describe('SignupPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    signUpMock.mockReset();
  });

  it('rejects mismatched passwords without calling Cognito', async () => {
    renderSignup();
    fill({ password: 'Passw0rd', confirm: 'Passw0rdX' });
    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it('rejects a password that fails the shared policy without calling Cognito', async () => {
    renderSignup();
    // The rule text is shown once as a persistent hint; on a policy failure the
    // error message echoes it, so it should then appear exactly twice.
    expect(screen.getAllByText(PASSWORD_RULE_HINT)).toHaveLength(1);
    fill({ password: 'weak', confirm: 'weak' });
    await waitFor(() => expect(screen.getAllByText(PASSWORD_RULE_HINT)).toHaveLength(2));
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it('signs up and routes to confirmation on a valid submission', async () => {
    signUpMock.mockResolvedValue({ isSignUpComplete: false });
    renderSignup();
    fill({ password: 'Passw0rd', confirm: 'Passw0rd' });
    await waitFor(() => expect(signUpMock).toHaveBeenCalledTimes(1));
    expect(signUpMock).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'citizen@example.com', password: 'Passw0rd' }),
    );
    expect(navigateMock).toHaveBeenCalledWith('/confirm-signup', {
      state: { email: 'citizen@example.com' },
    });
  });
});
