import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

const { getCurrentUserMock, fetchUserAttributesMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  fetchUserAttributesMock: vi.fn(),
}));

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: getCurrentUserMock,
  fetchUserAttributes: fetchUserAttributesMock,
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  confirmSignUp: vi.fn(),
  resendSignUpCode: vi.fn(),
}));

function AuthProbe() {
  const { isAuthenticated, email } = useAuth();
  return <div>{isAuthenticated ? `in:${email}` : 'out'}</div>;
}

describe('AuthContext', () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset();
    fetchUserAttributesMock.mockReset();
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
  });
});
