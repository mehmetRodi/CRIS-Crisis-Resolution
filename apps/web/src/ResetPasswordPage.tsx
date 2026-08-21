import { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { PASSWORD_RULE_HINT, isPasswordValid } from '@crisismap/shared';
import { useAuth } from './AuthContext';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { confirmResetPassword } = useAuth();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const email = location.state?.email || '';

  useEffect(() => {
    if (!email) {
      navigate('/forgot-password');
    }
  }, [email, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (!isPasswordValid(password)) {
      setError(PASSWORD_RULE_HINT);
      return;
    }

    setLoading(true);

    try {
      await confirmResetPassword(email, code, password);
      navigate('/login');
    } catch (err) {
      // Cognito throws these by name for a wrong/expired code — surface a
      // specific, actionable message rather than a generic failure.
      if (
        err instanceof Error &&
        (err.name === 'CodeMismatchException' || err.name === 'ExpiredCodeException')
      ) {
        setError('That code is invalid or has expired. Request a new one.');
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 bg-white p-8 rounded-2xl shadow-lg">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 text-center">Enter Reset Code</h2>
          <p className="mt-2 text-sm text-slate-600 text-center">
            Enter the code we emailed you and choose a new password
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label htmlFor="reset-code" className="block text-sm font-medium text-slate-700">
                Reset Code
              </label>
              <input
                id="reset-code"
                type="text"
                autoComplete="one-time-code"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2.5 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter 6-digit code"
                maxLength={6}
              />
            </div>
            <div>
              <label
                htmlFor="reset-password-new"
                className="block text-sm font-medium text-slate-700"
              >
                New Password
              </label>
              <input
                id="reset-password-new"
                type="password"
                autoComplete="new-password"
                aria-describedby="reset-password-hint"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2.5 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Minimum 8 characters"
              />
              <p id="reset-password-hint" className="mt-1 text-xs text-slate-500">
                {PASSWORD_RULE_HINT}
              </p>
            </div>
            <div>
              <label
                htmlFor="reset-password-confirm"
                className="block text-sm font-medium text-slate-700"
              >
                Confirm New Password
              </label>
              <input
                id="reset-password-confirm"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2.5 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Confirm your new password"
              />
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>

          <p className="text-center text-sm text-slate-600">
            <Link to="/login" className="font-medium text-blue-600 hover:text-blue-500">
              Back to Sign In
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
