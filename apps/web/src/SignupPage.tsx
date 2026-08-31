import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { PASSWORD_RULE_HINT, isPasswordValid } from '@crisismap/shared';

import { useAuth } from './AuthContext';
import { AuthError, AuthLayout } from './screens/AuthLayout';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { FieldHint, Label } from './components/ui/label';

/**
 * Account creation (CRIS-7, ADR-0024).
 *
 * A new account carries no operational Cognito group — an administrator grants
 * that separately (CRIS-24). The copy says so up front, because signing up and
 * then finding an empty workspace with no explanation is the worst version of
 * this flow.
 */
export default function SignupPage() {
  const navigate = useNavigate();
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!isPasswordValid(password)) {
      setError(PASSWORD_RULE_HINT);
      return;
    }

    setLoading(true);
    try {
      await signUp(email, password);
      navigate('/confirm-signup', { state: { email } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Create an account"
      description="Accounts are for response staff. An administrator assigns your role after sign-up."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-accent underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <Label htmlFor="signup-email">Email</Label>
          <Input
            id="signup-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.org"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="signup-password">Password</Label>
          <Input
            id="signup-password"
            type="password"
            autoComplete="new-password"
            required
            // The rule is the field's DESCRIPTION, not loose prose beside it, so
            // it is announced with the field — the constraint is known before a
            // failed submit rather than after (CRIS-27).
            aria-describedby="signup-password-hint"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <FieldHint id="signup-password-hint">{PASSWORD_RULE_HINT}</FieldHint>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="signup-confirm-password">Confirm password</Label>
          <Input
            id="signup-confirm-password"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </div>

        {error ? <AuthError message={error} /> : null}

        <Button type="submit" variant="primary" size="lg" disabled={loading} className="w-full">
          {loading ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
          {loading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
