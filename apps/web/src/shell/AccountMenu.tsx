import { useNavigate } from 'react-router-dom';
import { LogIn, LogOut, ShieldCheck, User } from 'lucide-react';

import { useAuth } from '../AuthContext';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { ROLE_META, roleLabel } from '../lib/domain-display';

/**
 * Identity and sign-out (CRIS-54).
 *
 * The menu states the caller's ROLE and what it grants, not just their email.
 * In this product the role is the single most consequential thing about a
 * session — it decides which incidents load and which actions exist — and the
 * previous UI showed it only as a bare `COORDINATOR` chip with no explanation
 * of what that meant or how to change it.
 */
export function AccountMenu() {
  const { email, highestRole, isAuthenticated, signOut } = useAuth();
  const navigate = useNavigate();

  if (!isAuthenticated) {
    return (
      <Button variant="secondary" size="sm" onClick={() => navigate('/login')}>
        <LogIn aria-hidden="true" />
        Sign in
      </Button>
    );
  }

  const meta = highestRole ? ROLE_META[highestRole] : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 rounded-lg border border-border/60 bg-surface/60 px-2.5 py-1.5 shadow-2xs hover:bg-surface-hover hover:border-border transition-all"
        >
          <span
            aria-hidden="true"
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent font-semibold text-xs ring-1 ring-accent/30"
          >
            {email ? email.charAt(0).toUpperCase() : <User className="size-3.5" />}
          </span>
          {/* Hidden on narrow viewports where the top bar is tight; the
              accessible name below keeps the control identifiable regardless. */}
          <span className="hidden max-w-[10rem] truncate text-xs font-semibold sm:inline">
            {roleLabel(highestRole)}
          </span>
          <span className="sr-only">Account menu for {email ?? 'signed-in user'}</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-[16rem] p-1.5 rounded-xl border-border/80 bg-surface/95 backdrop-blur-md shadow-lg">
        <DropdownMenuLabel className="px-2.5 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
          Signed in Account
        </DropdownMenuLabel>
        <div className="rounded-lg bg-surface-sunken/60 p-2.5 m-1 border border-border/40">
          <p className="truncate text-xs font-semibold text-fg">{email ?? 'Unknown account'}</p>
          {meta ? (
            <div className="mt-2">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent ring-1 ring-accent/20">
                <ShieldCheck aria-hidden="true" className="size-3.5" />
                {meta.label}
              </span>
              <p className="mt-1.5 text-[11px] leading-relaxed text-fg-muted">{meta.description}</p>
            </div>
          ) : (
            // A signed-in account in no Cognito group reaches nothing
            // operational. Say so plainly rather than showing an empty role.
            <p className="mt-1 text-xs text-fg-muted">
              No operational role assigned. Ask an administrator for access.
            </p>
          )}
        </div>
        <DropdownMenuSeparator className="my-1" />
        <DropdownMenuItem
          destructive
          className="rounded-lg px-2.5 py-2 text-xs font-medium cursor-pointer"
          onSelect={() => {
            void signOut().then(() => navigate('/'));
          }}
        >
          <LogOut aria-hidden="true" className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
