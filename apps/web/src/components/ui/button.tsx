import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/cn';

/**
 * The product's button (CRIS-54, ADR-0054).
 *
 * `destructive` is a SEPARATE variant from the severity palette on purpose:
 * severity colours describe an incident's state, this one describes an action's
 * consequence. They happen to share a hue; conflating them in code would make a
 * future divergence impossible.
 */
const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded font-medium',
    'transition-colors duration-100',
    // `aria-disabled` is styled alongside `:disabled` because several call
    // sites deliberately use the ARIA form to keep the control focusable and
    // its blocking reason reachable (ADR-0037). Both must LOOK unavailable.
    'disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50',
    // Icon sizing lives here so no call site repeats it, and `shrink-0` stops a
    // long label from squashing the icon into an unrecognisable sliver.
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ),
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-fg-on-solid shadow-xs hover:bg-accent-hover active:bg-accent-active',
        secondary: 'border border-border bg-surface text-fg shadow-xs hover:bg-surface-hover',
        ghost: 'text-fg-muted hover:bg-surface-hover hover:text-fg',
        destructive: 'bg-danger text-fg-on-solid shadow-xs hover:bg-danger/90',
        // Reads as body text until hovered. For in-sentence navigation, where a
        // button-shaped control would outrank the sentence around it.
        link: 'text-accent underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-2.5 text-xs',
        md: 'h-9 px-3.5 text-sm',
        lg: 'h-11 px-5 text-[15px]',
        // Reaches the 44px pointer-target minimum and spans its container. The
        // citizen path's primary action, used one-handed under stress.
        xl: 'h-12 w-full px-6 text-base',
        icon: 'size-9 p-0',
        'icon-sm': 'size-8 p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /**
   * Render the child element instead of a `<button>`, keeping these styles.
   * Lets a router `<Link>` look like a button without nesting an anchor inside
   * a button — which is invalid HTML and gives assistive tech two conflicting
   * roles for one control.
   */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        // A `<button>` inside a form defaults to `type="submit"`, so every
        // toolbar button in a form would submit it. Default to `button` and
        // make submitting explicit — but only when actually rendering a button,
        // since `asChild` may render an anchor, which has no `type`.
        {...(asChild ? {} : { type: type ?? 'button' })}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
