import { forwardRef } from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '../../lib/cn';

export const Label = forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn('text-sm font-medium leading-none text-fg', className)}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;

/**
 * Required-field marker (CRIS-27, carried over from the previous form).
 *
 * The asterisk is decoration — a screen reader either skips it or announces
 * "star", neither of which conveys "required" — so it is hidden from the
 * accessibility tree and paired with visually-hidden text that says the word.
 */
export function RequiredMark() {
  return (
    <>
      <span aria-hidden="true" className="text-danger">
        *
      </span>
      <span className="sr-only">(required)</span>
    </>
  );
}

/** Muted helper text. Wire it to its control with `aria-describedby`. */
export function FieldHint({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs text-fg-muted', className)} {...props} />;
}
