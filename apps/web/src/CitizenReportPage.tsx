import { ReportForm } from './ReportForm';
import { useNavigate } from 'react-router-dom';


function CitizenReportPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-6 px-4 sm:py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl">
        {/* Back Button */}
        <button
          onClick={() => navigate('/')}
          className="group mb-6 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 hover:shadow-md hover:text-slate-900"
        >
          <svg
            className="h-4 w-4 transition-transform group-hover:-translate-x-1"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          Back to Dashboard
        </button>

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-8 w-1 rounded-full bg-blue-600"></div>
            <span className="text-sm font-semibold uppercase tracking-wider text-blue-600">
              Emergency Reporting
            </span>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">CrisisMap AI</h1>
          <p className="mt-2 text-slate-500">
            Submit an emergency report to help responders act quickly
          </p>
        </div>

        {/* Form Card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-200/50 sm:p-8">
          <div className="mb-6 flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Submit Report</h2>
              <p className="mt-1 text-sm text-slate-500">
                Fill in the details below. All information is secure and encrypted.
              </p>
            </div>
          </div>
          <ReportForm />
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-xs text-slate-400">
            In case of immediate danger, call emergency services first.
          </p>
        </div>
      </div>
    </div>
  );
}

export default CitizenReportPage;

