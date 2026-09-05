import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { SiteFooter } from './SiteFooter';
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
    <div className={cn('flex min-h-dvh flex-col bg-bg', bleed && 'h-dvh overflow-hidden')}>
      <header className="grid h-16 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-border bg-surface px-4">
        <Link
          to={backTo}
          className="inline-flex min-h-11 min-w-11 items-center justify-self-start rounded-lg px-2 transition-colors hover:bg-surface-hover"
          aria-label={`Back to ${backLabel}`}
        >
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fg-muted transition-colors hover:text-fg">
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">{backLabel}</span>
          </span>
        </Link>
        <span className="justify-self-center">
          <Logo />
        </span>
        {/* Balances the back link so the logo stays optically centred. */}
        <Link
          to="/help"
          className="justify-self-end rounded-lg px-3 py-2 text-xs font-medium text-fg-muted hover:bg-surface-hover"
        >
          Help
        </Link>
      </header>

      {bleed ? (
        <main className="relative min-h-0 flex-1">{children}</main>
      ) : (
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6">
          {title ? (
            <div className="mb-6">
              <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
              {description ? <p className="mt-2 text-sm text-fg-muted">{description}</p> : null}
            </div>
          ) : null}
          {children}
        </main>
      )}
      {!bleed ? <SiteFooter /> : null}
    </div>
  );
}
