import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { cn } from '../../lib/cn';

/**
 * Radix defaults `decorative` to true, which hides the rule from assistive tech
 * — correct for the visual-only dividers used throughout, and the reason this
 * wraps the primitive rather than rendering a bare `<hr>`.
 */
export function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
}
