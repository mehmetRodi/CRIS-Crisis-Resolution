import type { PriorityBand } from '@crisismap/shared';

import { Badge } from '../ui/badge';
import { cn } from '../../lib/cn';
import { priorityMeta } from '../../lib/domain-display';
import { formatScore } from '../../lib/format';

/**
 * The priority band chip (CRIS-54).
 *
 * The accessible name says the band AND its meaning — "P0, Critical" — because
 * "P0" alone is jargon that carries no urgency to anyone reading by ear. The
 * visible text stays terse so the queue column stays narrow.
 */
export function PriorityBadge({
  band,
  score,
  className,
}: {
  band: PriorityBand | null | undefined;
  /** When given, the deterministic score renders beside the band. */
  score?: number | null;
  className?: string;
}) {
  const meta = priorityMeta(band);
  return (
    <Badge
      variant={meta.badge}
      className={cn('gap-1.5 font-semibold', className)}
      aria-label={band ? `${band}, ${meta.label}` : meta.label}
    >
      <span aria-hidden={!band}>{band ?? 'Unscored'}</span>
      {score != null ? (
        // Hidden from the name: the band already conveys the ranking, and
        // appending "4.2" to every row makes a screen-reader pass through the
        // queue substantially longer for no added meaning.
        <span aria-hidden="true" className="tabular font-normal opacity-70">
          {formatScore(score)}
        </span>
      ) : null}
    </Badge>
  );
}

/**
 * Solid severity dot for the map legend and marker keys, where a full badge
 * would not fit. Decorative by default — always pair it with adjacent text.
 */
export function PriorityDot({
  band,
  className,
}: {
  band: PriorityBand | null | undefined;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-2.5 shrink-0 rounded-xl',
        priorityMeta(band).solid,
        className,
      )}
    />
  );
}
