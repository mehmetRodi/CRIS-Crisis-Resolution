import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { useAuth } from './AuthContext';
import { AuthError, AuthLayout } from './screens/AuthLayout';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';

/**
 * Email verification (CRIS-7). Reached from sign-up, and from sign-in when
 * Cognito reports an unconfirmed account.
 */
export default function ConfirmSignupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { confirmSignUp, resendSignUpCode } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const email = (location.state as { email?: string } | null)?.email ?? '';

  // There is no code to verify without knowing whose account it belongs to.
  useEffect(() => {
    if (!email) navigate('/signup', { replace: true });
  }, [email, navigate]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await confirmSignUp(email, code);
      navigate('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code was not accepted.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError('');
    setNotice('');
    setResending(true);
    try {
      await resendSignUpCode(email);
      // Confirm the resend explicitly. Without it, the only feedback is the
      // button briefly changing label, and the user re-clicks it repeatedly.
      setNotice('A new code is on its way.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend the code.');
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthLayout
      title="Verify your email"
      description={
        email ? `We sent a six-digit code to ${email}.` : 'We sent you a six-digit code.'
      }
      footer={
        <Link to="/login" className="font-medium text-accent underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-code">Verification code</Label>
          <Input
            id="confirm-code"
            type="text"
            // `one-time-code` plus a numeric keypad lets password managers and
            // mobile keyboards handle the emailed code correctly (CRIS-27).
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="000000"
            className="tabular text-center text-lg tracking-[0.4em]"
          />
        </div>

        {error ? <AuthError message={error} /> : null}
        {notice ? (
          <p role="status" className="text-sm text-success">
            {notice}
          </p>
        ) : null}

        <Button type="submit" variant="primary" size="lg" disabled={loading} className="w-full">
          {loading ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
          {loading ? 'Verifying…' : 'Verify email'}
        </Button>

        <p className="text-center text-sm text-fg-muted">
          Didn&apos;t get a code?{' '}
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="font-medium text-accent underline-offset-4 hover:underline disabled:opacity-50"
          >
            {resending ? 'Sending…' : 'Resend it'}
          </button>
        </p>
      </form>
    </AuthLayout>
  );
}
