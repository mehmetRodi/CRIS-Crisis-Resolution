import { Link } from 'react-router-dom';

import { Logo } from '../components/brand/Logo';

/**
 * Shared frame for sign-in, sign-up, and email confirmation (CRIS-54).
 *
 * One layout for all three so the three-step account flow does not visibly
 * change shape between steps — the previous pages each rebuilt the same card
 * with slightly different spacing, which made the flow feel like three
 * unrelated screens.
 *
 * The escape hatch to `/report` is deliberate and prominent: someone who hits
 * the sign-in page during an actual emergency must not conclude that reporting
 * requires an account. It does not (ADR-0024).
 */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-transparent">
      <header className="flex h-16 shrink-0 items-center justify-center px-5">
        <Link to="/" className="rounded" aria-label="CRIS home">
          <Logo />
        </Link>
      </header>

      <main className="mx-auto w-full max-w-sm flex-1 px-5 pb-12">
        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
          <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
          <p className="mt-1.5 text-sm text-fg-muted">{description}</p>
          <div className="mt-6">{children}</div>
        </div>

        {footer ? <div className="mt-5 text-center text-sm text-fg-muted">{footer}</div> : null}

        <p className="mt-8 text-center text-xs text-fg-subtle">
          Reporting an emergency?{' '}
          <Link to="/report" className="font-medium text-accent underline-offset-4 hover:underline">
            Go straight to the report form
          </Link>{' '}
          — no account required.
        </p>
      </main>
    </div>
  );
}

/** Consistent inline error for the auth forms. */
export function AuthError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded border border-danger-border bg-danger-subtle px-3 py-2 text-sm text-danger"
    >
      {message}
    </div>
  );
}
