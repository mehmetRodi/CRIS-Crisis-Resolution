import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { useAuth } from './AuthContext';
import { AuthError, AuthLayout } from './screens/AuthLayout';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';

/**
 * Staff sign-in (CRIS-7, ADR-0024).
 *
 * On success the caller lands on the route that sent them here (`state.from`,
 * set by `RequireRole`) or on `/workspace`, which then routes them to the pane
 * their role actually works from. Returning them to `/` would put a homepage
 * between a responder and the incident they were paged about.
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const from = (location.state as { from?: string } | null)?.from;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await signIn(email, password);
      if (result.isSignedIn) {
        navigate(from ?? '/workspace', { replace: true });
      } else if (result.nextStep.signInStep === 'CONFIRM_SIGN_UP') {
        // The account exists but was never verified. Take them to confirmation
        // rather than reporting a credentials failure they cannot act on.
        navigate('/confirm-signup', { state: { email } });
      } else {
        setError('Additional verification is required to finish signing in.');
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'UserNotConfirmedException') {
        navigate('/confirm-signup', { state: { email } });
      } else {
        setError('Invalid email or password.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Sign in"
      description="For responders, coordinators, volunteers, and administrators."
      footer={
        <>
          Don&apos;t have an account?{' '}
          <Link to="/signup" className="font-medium text-accent underline-offset-4 hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <Label htmlFor="login-email">Email</Label>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.org"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="login-password">Password</Label>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {error ? <AuthError message={error} /> : null}

        <Button type="submit" variant="primary" size="lg" disabled={loading} className="w-full">
          {loading ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  );
}
