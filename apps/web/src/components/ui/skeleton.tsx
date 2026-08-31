import { cn } from '../../lib/cn';

/**
 * Loading placeholder.
 *
 * `aria-hidden` is not optional here: without it a screen reader announces a
 * run of empty boxes. The loading state is communicated by the live region that
 * accompanies every skeleton block, never by the skeleton itself.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded bg-surface-sunken', className)}
      {...props}
    />
  );
}
