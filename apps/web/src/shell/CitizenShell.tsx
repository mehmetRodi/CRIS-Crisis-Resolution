import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { Logo } from '../components/brand/Logo';
import { cn } from '../lib/cn';

/**
 * Chrome for the citizen surfaces (CRIS-54, ADR-0055).
 *
 * Deliberately NOT `AppShell`. A citizen filing a report is doing one thing,
 * once, under stress, often one-handed on a phone — so this shell carries no
 * navigation, no role chip, no live-connection indicator, and no account menu.
 * Every one of those is a place to get lost on the way to the only action that
 * matters.
 *
 * It keeps a single back affordance and the wordmark, so the page is still
 * identifiable and escapable.
 */
export function CitizenShell({
  backTo = '/',
  backLabel = 'Home',
  title,
  description,
  /** Rendered full-bleed, outside the centred column (used by the map). */
  bleed = false,
  children,
}: {
  backTo?: string;
  backLabel?: string;
  title?: string;
  description?: string;
  bleed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex min-h-dvh flex-col bg-transparent', bleed && 'h-dvh overflow-hidden')}>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <Link to={backTo} className="rounded" aria-label={`Back to ${backLabel}`}>
          <span className="inline-flex items-center gap-2 text-sm font-medium text-fg-muted transition-colors hover:text-fg">
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">{backLabel}</span>
          </span>
        </Link>
        <span className="mx-auto">
          <Logo />
        </span>
        {/* Balances the back link so the logo stays optically centred. */}
        <span aria-hidden="true" className="w-4 sm:w-[4.5rem]" />
      </header>

      {bleed ? (
        <main className="relative min-h-0 flex-1">{children}</main>
      ) : (
        <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6">
          {title ? (
            <div className="mb-6">
              <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
              {description ? <p className="mt-2 text-sm text-fg-muted">{description}</p> : null}
            </div>
          ) : null}
          {children}
        </main>
      )}
    </div>
  );
}
