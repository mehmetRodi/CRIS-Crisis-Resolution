import { Link } from 'react-router-dom';

import { ReportForm } from '../components/ReportForm';

/**
 * Web citizen report surface (ADR-0021). The mobile app is still the primary
 * channel, but an emergency has no time to install anything — anyone with a
 * link and a browser can file a report here. Layout mirrors the App shell
 * (slate-50 canvas, white card) so the two surfaces read as one product.
 */
export function ReportPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-xl px-6 py-10">
        <header className="mb-8">
          <Link
            to="/"
            className="text-sm text-slate-500 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            ← CrisisMap AI
          </Link>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">Report an emergency</h1>
          <p className="mt-2 text-slate-600">
            Describe what is happening and what is needed. Reports go straight to emergency
            coordinators — no account required.
          </p>
        </header>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <ReportForm />
        </div>
      </div>
    </main>
  );
}
