import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import ForgotPasswordPage from './ForgotPasswordPage';
import { AuthProvider } from './AuthContext';

const { navigateMock, resetPasswordMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  resetPasswordMock: vi.fn(),
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
  resetPassword: resetPasswordMock,
  confirmResetPassword: vi.fn(),
}));

function renderForgotPassword() {
  render(
    <MemoryRouter>
      <AuthProvider>
        <ForgotPasswordPage />
      </AuthProvider>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText(/^email$/i), {
    target: { value: 'citizen@example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: /send reset code/i }));
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    resetPasswordMock.mockReset();
  });

  it('shows the generic confirmation message when the request succeeds', async () => {
    resetPasswordMock.mockResolvedValue({});
    renderForgotPassword();
    expect(await screen.findByText(/if an account exists for that email/i)).toBeInTheDocument();
  });

  it('shows the same generic confirmation message even when Cognito rejects (no account-existence oracle)', async () => {
    const err = new Error('User does not exist.');
    err.name = 'UserNotFoundException';
    resetPasswordMock.mockRejectedValue(err);
    renderForgotPassword();
    expect(await screen.findByText(/if an account exists for that email/i)).toBeInTheDocument();
  });

  it('shows a distinct error for a genuine network failure', async () => {
    resetPasswordMock.mockRejectedValue(new TypeError('Failed to fetch'));
    renderForgotPassword();
    expect(await screen.findByText(/check your connection/i)).toBeInTheDocument();
  });

  it('navigates to /reset-password with the email once the user confirms they have a code', async () => {
    resetPasswordMock.mockResolvedValue({});
    renderForgotPassword();
    await screen.findByText(/if an account exists for that email/i);
    fireEvent.click(screen.getByRole('button', { name: /i have a code/i }));
    expect(navigateMock).toHaveBeenCalledWith('/reset-password', {
      state: { email: 'citizen@example.com' },
    });
  });

  it('calls resetPassword with the entered email', async () => {
    resetPasswordMock.mockResolvedValue({});
    renderForgotPassword();
    await waitFor(() =>
      expect(resetPasswordMock).toHaveBeenCalledWith({ username: 'citizen@example.com' }),
    );
  });
});
