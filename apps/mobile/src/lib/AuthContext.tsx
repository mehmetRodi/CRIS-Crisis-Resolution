import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  confirmResetPassword,
  confirmSignUp,
  fetchUserAttributes,
  getCurrentUser,
  resendSignUpCode,
  resetPassword,
  signIn,
  signOut,
  signUp,
} from 'aws-amplify/auth';
import type { AuthUser, SignInOutput } from 'aws-amplify/auth';

interface AuthContextType {
  user: AuthUser | null;
  email: string | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<SignInOutput>;
  signUp: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resendSignUpCode: (email: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  confirmResetPassword: (email: string, code: string, newPassword: string) => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Mobile twin of the web `AuthContext` (apps/web/src/AuthContext.tsx). Same
 * Cognito User Pool API surface and optional/non-blocking auth model
 * (ADR-0024) — only the platform wiring differs, same as the ReportForm
 * split between web and mobile (ADR-0021).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkUser();
  }, []);

  const checkUser = async () => {
    try {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
      const attributes = await fetchUserAttributes();
      setEmail(attributes.email ?? null);
    } catch {
      setUser(null);
      setEmail(null);
    } finally {
      setLoading(false);
    }
  };

  const signInHandler = async (userEmail: string, password: string): Promise<SignInOutput> => {
    const result = await signIn({ username: userEmail, password });
    // Only refresh identity when Cognito actually completed sign-in; otherwise
    // return the result so the caller can act on `nextStep` (e.g. confirm).
    if (result.isSignedIn) {
      await checkUser();
    }
    return result;
  };

  const signUpHandler = async (userEmail: string, password: string) => {
    await signUp({
      username: userEmail,
      password,
      options: { userAttributes: { email: userEmail } },
    });
  };

  const signOutHandler = async () => {
    await signOut();
    setUser(null);
    setEmail(null);
  };

  const confirmSignUpHandler = async (userEmail: string, code: string) => {
    await confirmSignUp({ username: userEmail, confirmationCode: code });
    await checkUser();
  };

  const resendCodeHandler = async (userEmail: string) => {
    await resendSignUpCode({ username: userEmail });
  };

  const resetPasswordHandler = async (userEmail: string) => {
    await resetPassword({ username: userEmail });
  };

  const confirmResetPasswordHandler = async (
    userEmail: string,
    code: string,
    newPassword: string,
  ) => {
    await confirmResetPassword({ username: userEmail, confirmationCode: code, newPassword });
  };

  const value: AuthContextType = {
    user,
    email,
    loading,
    signIn: signInHandler,
    signUp: signUpHandler,
    signOut: signOutHandler,
    confirmSignUp: confirmSignUpHandler,
    resendSignUpCode: resendCodeHandler,
    resetPassword: resetPasswordHandler,
    confirmResetPassword: confirmResetPasswordHandler,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
