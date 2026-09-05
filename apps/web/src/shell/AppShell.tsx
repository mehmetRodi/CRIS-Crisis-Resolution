import { NavLink } from 'react-router-dom';
import { Link } from 'react-router-dom';

import { Logo } from '../components/brand/Logo';
import { cn } from '../lib/cn';
import { AccountMenu } from './AccountMenu';

/**
 * The operational chrome (CRIS-54, ADR-0055).
 *
 * One shell for every signed-in operational role — the top bar, the navigation,
 * and the account menu are identical whether the caller is a volunteer or an
 * administrator. Only the panels INSIDE it adapt (see `capabilities.ts`). That
 * is what makes a role change legible: the furniture stays put and the contents
 * change, instead of each role landing in what looks like a different product.
 *
 * `h-dvh` rather than `h-screen`: on mobile browsers `100vh` includes the
 * retracting URL bar, so a full-height map is cut off by exactly the height of
 * that bar and the legend sits below the fold.
 */

export interface ShellNavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export function AppShell({
  nav,
  actions,
  children,
}: {
  /** Primary destinations, already narrowed to what this role may open. */
  nav: readonly ShellNavItem[];
  /** Surface-specific controls (connection status, refresh) for the top bar. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-transparent">
      {/* Skip link. First focusable element on the page, visually hidden until
          focused — without it, keyboard users traverse the entire nav on every
          route change before reaching the incident queue (CRIS-27). */}
      <a
        href="#workspace-main"
        className={cn(
          'sr-only focus:not-sr-only',
          'focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-accent',
          'focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-fg-on-solid',
        )}
      >
        Skip to main content
      </a>

      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/80 bg-surface/90 px-3 sm:px-4 backdrop-blur-md shadow-2xs">
        <Link to="/" className="rounded-lg transition-transform hover:scale-105 active:scale-95" aria-label="CRIS home">
          <Logo className="shrink-0" />
        </Link>

        {nav.length > 0 ? (
          <nav aria-label="Workspace sections" className="ml-3 flex items-center gap-1.5">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold tracking-wide transition-all',
                    isActive
                      ? 'bg-accent/15 text-accent shadow-xs ring-1 ring-accent/25'
                      : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                  )
                }
              >
                <item.icon className="size-4 shrink-0" aria-hidden="true" />
                {/* The label is the control's name, so it is never removed —
                    only visually collapsed on narrow bars. */}
                <span className="hidden sm:inline">{item.label}</span>
                <span className="sr-only sm:hidden">{item.label}</span>
              </NavLink>
            ))}
          </nav>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          {actions}
          <AccountMenu />
        </div>
      </header>

      <div id="workspace-main" className="flex min-h-0 flex-1">
        {children}
      </div>
    </div>
  );
}
