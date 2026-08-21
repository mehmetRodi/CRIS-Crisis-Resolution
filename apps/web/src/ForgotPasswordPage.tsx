import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from './AuthContext';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await resetPassword(email);
      setSubmitted(true);
    } catch (err) {
      // Cognito's own account-existence behaviour is not something this page
      // should surface either way — a nonexistent-user error must land on the
      // exact same generic message as success, or the form becomes an oracle
      // for which emails are registered. Only a genuine infra failure (a
      // thrown network error, no Cognito response at all) gets its own message.
      if (err instanceof TypeError) {
        setError('Something went wrong. Check your connection and try again.');
      } else {
        setSubmitted(true);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 bg-white p-8 rounded-2xl shadow-lg">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 text-center">Reset Password</h2>
          <p className="mt-2 text-sm text-slate-600 text-center">
            Enter your email and we'll send you a reset code
          </p>
        </div>

        {submitted ? (
          <div className="space-y-6">
            <div
              role="status"
              className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700"
            >
              If an account exists for that email, we've sent a reset code. Check your inbox.
            </div>
            <button
              type="button"
              onClick={() => navigate('/reset-password', { state: { email } })}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
            >
              I have a code
            </button>
          </div>
        ) : (
          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            <div>
              <label
                htmlFor="forgot-password-email"
                className="block text-sm font-medium text-slate-700"
              >
                Email
              </label>
              <input
                id="forgot-password-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2.5 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter your email"
              />
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
              {loading ? 'Sending...' : 'Send Reset Code'}
            </button>
          </form>
        )}

        <p className="text-center text-sm text-slate-600">
          <Link to="/login" className="font-medium text-blue-600 hover:text-blue-500">
            Back to Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}
