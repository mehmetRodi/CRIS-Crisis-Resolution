import { ReportForm } from './ReportForm';

function CitizenReportPage() {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
      <header className="mb-8">
        <h2 className="text-3xl font-bold text-slate-900">
          Report an Emergency
        </h2>

        <p className="mt-2 text-slate-600">
          Submit information about an emergency or disaster. Your report will be
          reviewed and prioritized to help emergency responders react quickly.
        </p>
      </header>

      <ReportForm />
    </section>
  );
}

export default CitizenReportPage;