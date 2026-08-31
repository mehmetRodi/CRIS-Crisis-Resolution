import { forwardRef } from 'react';
import { cn } from '../../lib/cn';

/**
 * Multi-line input. `resize-y` only: horizontal resize lets a user drag the
 * control outside its column and break the layout, and buys nothing.
 */
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'w-full resize-y rounded border border-border bg-surface px-3 py-2 text-sm text-fg shadow-xs',
      'placeholder:text-fg-subtle',
      'hover:border-border-strong',
      'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-fg-subtle',
      'aria-[invalid=true]:border-danger aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-danger',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';
