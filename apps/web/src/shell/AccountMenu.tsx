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
        <Button variant="ghost" size="sm" className="gap-2 pl-1.5 pr-2">
          <span
            aria-hidden="true"
            className="flex size-6 items-center justify-center rounded-xl bg-accent-subtle text-accent-subtle-fg"
          >
            <User className="size-3.5" />
          </span>
          {/* Hidden on narrow viewports where the top bar is tight; the
              accessible name below keeps the control identifiable regardless. */}
          <span className="hidden max-w-[10rem] truncate text-xs font-medium sm:inline">
            {roleLabel(highestRole)}
          </span>
          <span className="sr-only">Account menu for {email ?? 'signed-in user'}</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-[15rem]">
        <DropdownMenuLabel>Signed in</DropdownMenuLabel>
        <div className="px-2 pb-2">
          <p className="truncate text-sm font-medium text-fg">{email ?? 'Unknown account'}</p>
          {meta ? (
            <>
              <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-accent-subtle-fg">
                <ShieldCheck aria-hidden="true" className="size-3.5" />
                {meta.label}
              </p>
              <p className="mt-0.5 text-xs text-fg-muted">{meta.description}</p>
            </>
          ) : (
            // A signed-in account in no Cognito group reaches nothing
            // operational. Say so plainly rather than showing an empty role.
            <p className="mt-1 text-xs text-fg-muted">
              No operational role assigned. Ask an administrator for access.
            </p>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          destructive
          onSelect={() => {
            void signOut().then(() => navigate('/'));
          }}
        >
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
