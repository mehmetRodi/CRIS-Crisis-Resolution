import { useState, useEffect } from 'react';
import { getCurrentUser } from 'aws-amplify/auth';

export function useAuthStatus() {
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const user = await getCurrentUser();
      setSignedIn(true);
      setUsername(user.username);
    } catch {
      setSignedIn(false);
      setUsername(null);
    } finally {
      setLoading(false);
    }
  };

  return { loading, signedIn, username };
}