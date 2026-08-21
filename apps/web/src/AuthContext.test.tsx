import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

const {
  getCurrentUserMock,
  fetchUserAttributesMock,
  fetchAuthSessionMock,
  resetPasswordMock,
  confirmResetPasswordMock,
} = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  fetchUserAttributesMock: vi.fn(),
  fetchAuthSessionMock: vi.fn(),
  resetPasswordMock: vi.fn(),
  confirmResetPasswordMock: vi.fn(),
}));

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: getCurrentUserMock,
  fetchUserAttributes: fetchUserAttributesMock,
  fetchAuthSession: fetchAuthSessionMock,
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  confirmSignUp: vi.fn(),
  resendSignUpCode: vi.fn(),
  resetPassword: resetPasswordMock,
  confirmResetPassword: confirmResetPasswordMock,
}));

function AuthProbe() {
  const { isAuthenticated, email, roles, highestRole } = useAuth();
  return (
    <div>
      {isAuthenticated ? `in:${email}` : 'out'}
      <span data-testid="roles">{roles.join(',')}</span>
      <span data-testid="highest-role">{highestRole ?? 'none'}</span>
    </div>
  );
}

function ResetProbe() {
  const { resetPassword, confirmResetPassword } = useAuth();
  return (
    <div>
      <button onClick={() => void resetPassword('citizen@example.com')}>request</button>
      <button
        onClick={() => void confirmResetPassword('citizen@example.com', '123456', 'NewPassw0rd')}
      >
        confirm
      </button>
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset();
    fetchUserAttributesMock.mockReset();
    fetchAuthSessionMock.mockReset();
    fetchAuthSessionMock.mockResolvedValue({ tokens: undefined });
    resetPasswordMock.mockReset();
    confirmResetPasswordMock.mockReset();
  });

  it('throws when useAuth is used outside an AuthProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<AuthProbe />)).toThrow(/must be used within an AuthProvider/i);
    spy.mockRestore();
  });

  it('exposes the signed-in identity once checkUser resolves', async () => {
    getCurrentUserMock.mockResolvedValue({ userId: 'u1', username: 'citizen@example.com' });
    fetchUserAttributesMock.mockResolvedValue({ email: 'citizen@example.com' });
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    expect(await screen.findByText('in:citizen@example.com')).toBeInTheDocument();
  });

  it('settles unauthenticated when there is no current user', async () => {
    getCurrentUserMock.mockRejectedValue(new Error('not signed in'));
    fetchUserAttributesMock.mockResolvedValue({});
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    expect(await screen.findByText('out')).toBeInTheDocument();
    expect(screen.getByTestId('highest-role')).toHaveTextContent('none');
  });

  it('exposes Cognito groups from the ID token as roles, and the highest as highestRole', async () => {
    getCurrentUserMock.mockResolvedValue({ userId: 'u1', username: 'coordinator@example.com' });
    fetchUserAttributesMock.mockResolvedValue({ email: 'coordinator@example.com' });
    fetchAuthSessionMock.mockResolvedValue({
      tokens: { idToken: { payload: { 'cognito:groups': ['RESPONDER', 'COORDINATOR'] } } },
    });
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('roles')).toHaveTextContent('RESPONDER,COORDINATOR'),
    );
    expect(screen.getByTestId('highest-role')).toHaveTextContent('COORDINATOR');
  });

  it('degrades to no roles when the session has no ID token (e.g. guest identity)', async () => {
    getCurrentUserMock.mockResolvedValue({ userId: 'u1', username: 'citizen@example.com' });
    fetchUserAttributesMock.mockResolvedValue({ email: 'citizen@example.com' });
    fetchAuthSessionMock.mockRejectedValue(new Error('no session'));
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    expect(await screen.findByText('in:citizen@example.com')).toBeInTheDocument();
    expect(screen.getByTestId('highest-role')).toHaveTextContent('none');
  });

  it('resetPassword delegates to Cognito with the given username', async () => {
    getCurrentUserMock.mockRejectedValue(new Error('not signed in'));
    fetchUserAttributesMock.mockResolvedValue({});
    resetPasswordMock.mockResolvedValue(undefined);
    render(
      <AuthProvider>
        <ResetProbe />
      </AuthProvider>,
    );
    screen.getByText('request').click();
    await waitFor(() =>
      expect(resetPasswordMock).toHaveBeenCalledWith({ username: 'citizen@example.com' }),
    );
  });

  it('confirmResetPassword delegates to Cognito with the code and new password', async () => {
    getCurrentUserMock.mockRejectedValue(new Error('not signed in'));
    fetchUserAttributesMock.mockResolvedValue({});
    confirmResetPasswordMock.mockResolvedValue(undefined);
    render(
      <AuthProvider>
        <ResetProbe />
      </AuthProvider>,
    );
    screen.getByText('confirm').click();
    await waitFor(() =>
      expect(confirmResetPasswordMock).toHaveBeenCalledWith({
        username: 'citizen@example.com',
        confirmationCode: '123456',
        newPassword: 'NewPassw0rd',
      }),
    );
  });
});
