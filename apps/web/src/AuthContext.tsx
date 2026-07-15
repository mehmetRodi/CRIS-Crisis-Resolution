import { createContext, useContext, useState, useEffect } from 'react';
import { 
  getCurrentUser, 
  signIn, 
  signUp, 
  signOut, 
  confirmSignUp, 
  resendSignUpCode 
} from 'aws-amplify/auth';
import type { AuthUser } from 'aws-amplify/auth';

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (username: string, password: string, email: string) => Promise<void>;
  signOut: () => Promise<void>;
  confirmSignUp: (username: string, code: string) => Promise<void>;
  resendSignUpCode: (username: string) => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkUser();
  }, []);

  const checkUser = async () => {
    try {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const signInHandler = async (username: string, password: string) => {
    const result = await signIn({ username, password });
    if (result.isSignedIn) {
      await checkUser();
    }
  };

  const signUpHandler = async (username: string, password: string, email: string) => {
    await signUp({
      username,
      password,
      options: { userAttributes: { email } },
    });
  };

  const signOutHandler = async () => {
    await signOut();
    setUser(null);
  };

  const confirmSignUpHandler = async (username: string, code: string) => {
    await confirmSignUp({ username, confirmationCode: code });
    await checkUser();
  };

  const resendCodeHandler = async (username: string) => {
    await resendSignUpCode({ username });
  };

  const value = {
    user,
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