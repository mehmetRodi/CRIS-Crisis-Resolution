import { createContext, useContext, useState, useEffect } from 'react';
import { 
  getCurrentUser, 
  fetchUserAttributes,
  signIn, 
  signUp, 
  signOut, 
  confirmSignUp, 
  resendSignUpCode 
} from 'aws-amplify/auth';
import type { AuthUser } from 'aws-amplify/auth';

interface AuthContextType {
  user: AuthUser | null;
  email: string | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resendSignUpCode: (email: string) => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
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
    } finally {
      setLoading(false);
    }
  };

  const signInHandler = async (userEmail: string, password: string) => {
    const result = await signIn({ username: userEmail, password  });
    if (result.isSignedIn) {
      await checkUser();
    }
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

  const value = {
    user,
    email,
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