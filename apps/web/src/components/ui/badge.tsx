import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

/**
 * Compact status/label chip (CRIS-54).
 *
 * Every variant pairs a tinted fill with a matching border and a dark text
 * colour, rather than white-on-saturated. At badge size a saturated fill with
 * white text is loud enough to compete with the P0 markers on the map, and a
 * queue of forty of them becomes unreadable — the severity ranking has to come
 * from hue, not from shouting.
 *
 * The four `p0`–`p3` variants are the ONLY place band colour is decided; see
 * `PriorityBadge` for the component that maps a band onto them.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-xs font-medium leading-4',
  {
    variants: {
      variant: {
        neutral: 'border-border bg-surface-sunken text-fg-muted',
        accent: 'border-accent-border bg-accent-subtle text-accent-subtle-fg',
        success: 'border-success-border bg-success-subtle text-success',
        warning: 'border-warning-border bg-warning-subtle text-warning',
        danger: 'border-danger-border bg-danger-subtle text-danger',
        info: 'border-info-border bg-info-subtle text-info',
        p0: 'border-severity-p0-border bg-severity-p0-subtle text-severity-p0',
        p1: 'border-severity-p1-border bg-severity-p1-subtle text-severity-p1',
        p2: 'border-severity-p2-border bg-severity-p2-subtle text-severity-p2',
        p3: 'border-severity-p3-border bg-severity-p3-subtle text-severity-p3',
        unscored: 'border-severity-none-border bg-severity-none-subtle text-severity-none',
        // Filled, for the one badge that must win against a photographic map
        // tile behind it.
        solid: 'border-transparent bg-fg text-fg-on-solid',
      },
      size: {
        sm: 'px-1.5 py-0.5 text-[11px]',
        md: 'px-2 py-0.5 text-xs',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'md' },
  },
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}
