import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import LoginPage from './LoginPage';
import SignupPage from './SignupPage';
import ConfirmSignupPage from './ConfirmSignupPage';
import { AuthProvider } from './AuthContext';

/**
 * Accessibility contract for the three auth forms (CRIS-27).
 *
 * These assert the parts a sighted click-through cannot catch: that every field
 * is reachable *by its label* rather than by placeholder, and that errors are
 * announced rather than merely rendered. Querying with `getByLabelText` is the
 * assertion — it resolves through the same accessible-name computation a screen
 * reader uses, so it fails if `htmlFor`/`id` association is ever dropped.
 */

const { signInMock, confirmSignUpMock } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  confirmSignUpMock: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => vi.fn() };
});

// getCurrentUser rejects (guest), so AuthProvider settles unauthenticated.
vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: () => Promise.reject(new Error('not signed in')),
  fetchUserAttributes: () => Promise.resolve({}),
  signIn: signInMock,
  signUp: vi.fn(),
  signOut: vi.fn(),
  confirmSignUp: confirmSignUpMock,
  resendSignUpCode: vi.fn(),
}));

/** Renders a page inside the router + auth providers it expects. */
function renderPage(ui: React.ReactElement, initialEntry?: { pathname: string; state: unknown }) {
  return render(
    <MemoryRouter initialEntries={initialEntry ? [initialEntry] : ['/']}>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>,
  );
}

describe('auth form accessibility', () => {
  beforeEach(() => {
    signInMock.mockReset();
    confirmSignUpMock.mockReset();
  });

  describe('LoginPage', () => {
    it('exposes every field by its visible label', async () => {
      renderPage(<LoginPage />);

      // findBy* also flushes AuthProvider's pending checkUser() settle.
      expect(await screen.findByLabelText(/^email$/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    });

    it('marks the credential fields for password-manager autofill', async () => {
      renderPage(<LoginPage />);

      expect(await screen.findByLabelText(/^email$/i)).toHaveAttribute('autocomplete', 'email');
      expect(screen.getByLabelText(/^password$/i)).toHaveAttribute(
        'autocomplete',
        'current-password',
      );
    });

    it('announces a failed sign-in through an alert region', async () => {
      signInMock.mockRejectedValue(new Error('NotAuthorizedException'));
      renderPage(<LoginPage />);

      fireEvent.change(screen.getByLabelText(/^email$/i), {
        target: { value: 'citizen@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'wrong' } });
      fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/invalid email or password/i);
    });
  });

  describe('SignupPage', () => {
    it('exposes every field by its visible label', async () => {
      renderPage(<SignupPage />);

      expect(await screen.findByLabelText(/^email$/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    });

    it('describes the password field with the rule hint', async () => {
      renderPage(<SignupPage />);

      // The hint must be *associated*, not just nearby — otherwise the constraint
      // is invisible to a screen reader until submission fails.
      expect(await screen.findByLabelText(/^password$/i)).toHaveAccessibleDescription(
        /at least 8 characters/i,
      );
    });

    it('announces a validation failure through an alert region', async () => {
      renderPage(<SignupPage />);

      fireEvent.change(screen.getByLabelText(/^email$/i), {
        target: { value: 'citizen@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'Passw0rd!' } });
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'different' },
      });
      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/passwords do not match/i);
    });
  });

  describe('ConfirmSignupPage', () => {
    const withEmail = {
      pathname: '/confirm-signup',
      state: { email: 'citizen@example.com' },
    };

    it('exposes the code field by its visible label', async () => {
      renderPage(<ConfirmSignupPage />, withEmail);

      expect(await screen.findByLabelText(/verification code/i)).toBeInTheDocument();
    });

    it('requests a numeric keypad and one-time-code autofill', async () => {
      renderPage(<ConfirmSignupPage />, withEmail);

      const code = await screen.findByLabelText(/verification code/i);
      expect(code).toHaveAttribute('autocomplete', 'one-time-code');
      expect(code).toHaveAttribute('inputmode', 'numeric');
    });

    it('announces a rejected code through an alert region', async () => {
      confirmSignUpMock.mockRejectedValue(new Error('Invalid verification code'));
      renderPage(<ConfirmSignupPage />, withEmail);

      fireEvent.change(screen.getByLabelText(/verification code/i), {
        target: { value: '000000' },
      });
      fireEvent.click(screen.getByRole('button', { name: /verify email/i }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/invalid verification code/i);
    });
  });
});
