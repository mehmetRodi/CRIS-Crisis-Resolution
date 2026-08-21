import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ResetPasswordPage from './ResetPasswordPage';
import { AuthProvider } from './AuthContext';

const { navigateMock, confirmResetPasswordMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  confirmResetPasswordMock: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: () => Promise.reject(new Error('not signed in')),
  fetchUserAttributes: () => Promise.resolve({}),
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  confirmSignUp: vi.fn(),
  resendSignUpCode: vi.fn(),
  resetPassword: vi.fn(),
  confirmResetPassword: confirmResetPasswordMock,
}));

// react-router's useLocation reads real router state, so a MemoryRouter with
// an initial `state` entry exercises the same location.state?.email path the
// page relies on — matching how ConfirmSignupPage's equivalent redirect guard
// is normally exercised. No default: a JS default parameter would silently
// substitute even when a caller explicitly passes `undefined`, defeating the
// "no email" test case below.
function renderResetPassword(initialState: { email: string } | undefined) {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/reset-password', state: initialState }]}>
      <AuthProvider>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function fillAndSubmit(overrides: { code?: string; password?: string; confirm?: string } = {}) {
  fireEvent.change(screen.getByLabelText(/reset code/i), {
    target: { value: overrides.code ?? '123456' },
  });
  fireEvent.change(screen.getByLabelText(/^new password$/i), {
    target: { value: overrides.password ?? 'NewPassw0rd' },
  });
  fireEvent.change(screen.getByLabelText(/confirm new password/i), {
    target: { value: overrides.confirm ?? overrides.password ?? 'NewPassw0rd' },
  });
  fireEvent.click(screen.getByRole('button', { name: /reset password/i }));
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    confirmResetPasswordMock.mockReset();
  });

  it('redirects to /forgot-password when no email was carried in navigation state', async () => {
    renderResetPassword(undefined);
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/forgot-password'));
  });

  it('rejects mismatched passwords without calling Cognito', async () => {
    renderResetPassword({ email: 'citizen@example.com' });
    fillAndSubmit({ password: 'NewPassw0rd', confirm: 'Different1' });
    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(confirmResetPasswordMock).not.toHaveBeenCalled();
  });

  it('rejects a password that fails the shared strength rule without calling Cognito', async () => {
    renderResetPassword({ email: 'citizen@example.com' });
    fillAndSubmit({ password: 'weak', confirm: 'weak' });
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 8 characters/i);
    expect(confirmResetPasswordMock).not.toHaveBeenCalled();
  });

  it('calls confirmResetPassword and navigates to /login on success', async () => {
    confirmResetPasswordMock.mockResolvedValue(undefined);
    renderResetPassword({ email: 'citizen@example.com' });
    fillAndSubmit();
    await waitFor(() =>
      expect(confirmResetPasswordMock).toHaveBeenCalledWith({
        username: 'citizen@example.com',
        confirmationCode: '123456',
        newPassword: 'NewPassw0rd',
      }),
    );
    expect(navigateMock).toHaveBeenCalledWith('/login');
  });

  it('shows a specific message for an invalid or expired code', async () => {
    const err = new Error('Invalid code provided');
    err.name = 'CodeMismatchException';
    confirmResetPasswordMock.mockRejectedValue(err);
    renderResetPassword({ email: 'citizen@example.com' });
    fillAndSubmit();
    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalledWith('/login');
  });
});
