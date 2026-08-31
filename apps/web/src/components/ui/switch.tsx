import { forwardRef } from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';

import { cn } from '../../lib/cn';

/**
 * Binary toggle for settings that apply immediately (e.g. anonymous reporting).
 * Radix renders a real `role="switch"` with `aria-checked`, which a styled
 * checkbox does not — and "anonymous: on/off" is exactly the state a reporter
 * needs read back to them correctly.
 */
export const Switch = forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-xl border-2 border-transparent transition-colors',
      'data-[state=checked]:bg-accent data-[state=unchecked]:bg-border-strong',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'pointer-events-none block size-5 rounded-xl bg-surface shadow-sm ring-0 transition-transform',
        'data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0',
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;
