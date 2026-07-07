import { ReportForm } from './ReportForm';

function CitizenReportPage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-bold">
          Report an Emergency
        </h1>

        <p className="mt-2 text-slate-600">
          Describe the incident so emergency coordinators can respond quickly.
        </p>

        <ReportForm />
      </div>
    </main>
  );
}

export default CitizenReportPage;