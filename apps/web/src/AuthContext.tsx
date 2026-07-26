import { createContext, useContext, useState, useEffect } from 'react';
import {
  getCurrentUser,
  fetchUserAttributes,
  fetchAuthSession,
  signIn,
  signUp,
  signOut,
  confirmSignUp,
  resendSignUpCode,
} from 'aws-amplify/auth';
import type { AuthUser, SignInOutput } from 'aws-amplify/auth';
import { highestRole as resolveHighestRole, UserRole } from '@crisismap/shared';

interface AuthContextType {
  user: AuthUser | null;
  email: string | null;
  /** Cognito groups on the caller's ID token (CRIS-24). Empty when signed out. */
  roles: UserRole[];
  /** The single highest-privilege role among `roles`, or `null` if none/none match. */
  highestRole: UserRole | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<SignInOutput>;
  signUp: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resendSignUpCode: (email: string) => Promise<void>;
  isAuthenticated: boolean;
}

/** Narrows the ID token's `cognito:groups` claim to known `UserRole` values. */
function parseRoles(groups: unknown): UserRole[] {
  if (!Array.isArray(groups)) return [];
  const known: readonly string[] = Object.values(UserRole);
  return groups.filter((g): g is UserRole => typeof g === 'string' && known.includes(g));
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
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
      // Cognito groups ride the ID token, not user attributes (CRIS-24) — read
      // separately, and tolerate its absence (e.g. an identityPool-only guest
      // session has no user-pool ID token at all).
      try {
        const session = await fetchAuthSession();
        setRoles(parseRoles(session.tokens?.idToken?.payload['cognito:groups']));
      } catch {
        setRoles([]);
      }
    } catch {
      setUser(null);
      setEmail(null);
      setRoles([]);
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
    setRoles([]);
  };

  const confirmSignUpHandler = async (userEmail: string, code: string) => {
    await confirmSignUp({ username: userEmail, confirmationCode: code });
    await checkUser();
  };

  const resendCodeHandler = async (userEmail: string) => {
    await resendSignUpCode({ username: userEmail });
  };

  const value: AuthContextType = {
    user,
    email,
    roles,
    highestRole: resolveHighestRole(roles),
    loading,
    signIn: signInHandler,
    signUp: signUpHandler,
    signOut: signOutHandler,
    confirmSignUp: confirmSignUpHandler,
    resendSignUpCode: resendCodeHandler,
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
