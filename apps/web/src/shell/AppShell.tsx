import { NavLink, Link } from 'react-router-dom';
import { CircleHelp, Plus } from 'lucide-react';
import { Logo } from '../components/brand/Logo';
import { cn } from '../lib/cn';
import { AccountMenu } from './AccountMenu';
import { SiteFooter } from './SiteFooter';

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
  nav: readonly ShellNavItem[];
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      <a
        href="#workspace-main"
        className="sr-only z-50 rounded-lg bg-surface p-3 text-accent focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to main content
      </a>
      <header className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b border-border bg-surface px-4 py-3 sm:px-6">
        <Link to="/" aria-label="CRIS home" className="shrink-0 rounded-lg">
          <Logo />
        </Link>
        <nav
          aria-label="Workspace sections"
          className="order-3 flex w-full items-center gap-1 border-t border-border pt-2 sm:order-none sm:w-auto sm:border-t-0 sm:pt-0"
        >
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent-subtle text-accent-subtle-fg'
                    : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                )
              }
            >
              <item.icon className="size-4 shrink-0" aria-hidden="true" />
              {item.label}
            </NavLink>
          ))}
          <Link
            to="/report"
            className="flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium text-fg-muted hover:bg-surface-hover"
          >
            <Plus className="size-4" aria-hidden="true" />
            New report
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {actions}
          <Link
            to="/help"
            aria-label="Help and guidance"
            className="hidden rounded-lg p-2 text-fg-muted hover:bg-surface-hover lg:block"
          >
            <CircleHelp className="size-4" aria-hidden="true" />
          </Link>
          <AccountMenu />
        </div>
      </header>
      <main id="workspace-main" tabIndex={-1} className="flex min-h-0 flex-1 p-2 sm:p-4">
        {children}
      </main>
      <SiteFooter compact />
    </div>
  );
}
