import type { LucideIcon } from 'lucide-react';

import { cn } from '../../lib/cn';

/**
 * The product's one empty/idle/error presentation (CRIS-54).
 *
 * A single component because empty states are where a crisis tool most often
 * lies to its user: "No incidents" and "Couldn't load incidents" look identical
 * if each screen improvises its own, and a coordinator reading the first when
 * the second is true will believe the region is quiet. Every caller must pass a
 * `title` that states which of the two it is.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = 'neutral',
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** `error` colours the icon and announces assertively. */
  tone?: 'neutral' | 'error';
  className?: string;
}) {
  const isError = tone === 'error';
  return (
    <div
      // A failure is announced immediately; an ordinary empty result waits for a
      // natural pause, so it does not interrupt whatever is being read.
      role={isError ? 'alert' : 'status'}
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-sunken/60 px-6 py-10 text-center',
        className,
      )}
    >
      {Icon ? (
        <Icon
          aria-hidden="true"
          className={cn('size-6', isError ? 'text-danger' : 'text-fg-subtle')}
        />
      ) : null}
      <p className={cn('text-sm font-medium', isError ? 'text-danger' : 'text-fg')}>{title}</p>
      {description ? <p className="max-w-sm text-xs text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
