import { forwardRef } from 'react';
import { cn } from '../../lib/cn';

/**
 * Text input. Height matches `Button` size `md` so a control and its adjacent
 * button align on a single row without per-site nudging.
 *
 * `aria-invalid` drives the error styling rather than a boolean prop: the
 * attribute has to be present for assistive tech anyway, so deriving the visual
 * state from it makes the two physically impossible to disagree.
 */
export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded border border-border bg-surface px-3 text-sm text-fg shadow-xs',
        'placeholder:text-fg-subtle',
        'hover:border-border-strong',
        'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-fg-subtle',
        'aria-[invalid=true]:border-danger aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-danger',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
