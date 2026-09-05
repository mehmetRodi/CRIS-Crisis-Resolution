import { Link } from 'react-router-dom';
import { cn } from '../lib/cn';

export function SiteFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer
      className={cn(
        'shrink-0 border-t border-border text-xs text-fg-muted',
        compact ? 'bg-surface px-4 py-3' : 'px-5 py-7',
      )}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <p>
          CRIS <span className="mx-1 text-border-strong">/</span> Crisis Resolution
        </p>
        <nav aria-label="Information" className="flex flex-wrap gap-5">
          <Link className="hover:text-accent hover:underline" to="/about">
            About
          </Link>
          <Link className="hover:text-accent hover:underline" to="/help">
            Help
          </Link>
          <Link className="hover:text-accent hover:underline" to="/privacy">
            Privacy
          </Link>
          <Link className="hover:text-accent hover:underline" to="/terms">
            Terms of use
          </Link>
        </nav>
      </div>
    </footer>
  );
}
