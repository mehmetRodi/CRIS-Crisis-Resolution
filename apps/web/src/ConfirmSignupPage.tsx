import { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from './AuthContext';

export default function ConfirmSignupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { confirmSignUp, resendSignUpCode } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const email = location.state?.email || '';

  useEffect(() => {
    if (!email) {
      navigate('/signup');
    }
  }, [email, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await confirmSignUp(email, code);
      navigate('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      await resendSignUpCode(email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend code');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 bg-white p-8 rounded-2xl shadow-lg">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 text-center">Verify Your Account</h2>
          <p className="mt-2 text-sm text-slate-600 text-center">
            We sent a verification code to your email
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm font-medium text-slate-700">Verification Code</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2.5 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter 6-digit code"
              maxLength={6}
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Verifying...' : 'Verify Email'}
          </button>

          <p className="text-center text-sm text-slate-600">
            Didn't receive a code?{' '}
            <button
              type="button"
              onClick={handleResend}
              disabled={resending}
              className="font-medium text-blue-600 hover:text-blue-500 disabled:opacity-50"
            >
              {resending ? 'Sending...' : 'Resend Code'}
            </button>
          </p>

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
