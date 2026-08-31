import { PriorityBand } from '@crisismap/shared';

import { cn } from '../../lib/cn';
import { PRIORITY_META, UNSCORED_META } from '../../lib/domain-display';

const BANDS = [PriorityBand.P0, PriorityBand.P1, PriorityBand.P2, PriorityBand.P3] as const;

/**
 * Severity key for the map (CRIS-54).
 *
 * Without it, the marker colours are an undocumented code — a new responder has
 * no way to learn that orange outranks amber. It also states the cluster rule
 * explicitly, because "the worst incident in a cluster decides its colour" is
 * not inferable from looking, and a coordinator who assumes clusters are
 * averaged will misread a grey bubble containing a P0.
 */
export function MapLegend({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'pointer-events-none select-none rounded-lg border border-border bg-surface/95 px-3 py-2.5 shadow-md backdrop-blur',
        className,
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Priority</p>
      <ul className="mt-1.5 space-y-1">
        {BANDS.map((band) => {
          const meta = PRIORITY_META[band];
          return (
            <li key={band} className="flex items-center gap-2 text-xs text-fg-muted">
              <span
                aria-hidden="true"
                className={cn('size-2.5 shrink-0 rounded-xl ring-2 ring-surface', meta.solid)}
              />
              <span className="font-medium text-fg">{band}</span>
              <span>{meta.label}</span>
            </li>
          );
        })}
        <li className="flex items-center gap-2 text-xs text-fg-muted">
          <span
            aria-hidden="true"
            className={cn('size-2.5 shrink-0 rounded-xl ring-2 ring-surface', UNSCORED_META.solid)}
          />
          <span className="font-medium text-fg">—</span>
          <span>{UNSCORED_META.label}</span>
        </li>
      </ul>
      <p className="mt-2 max-w-[13rem] border-t border-border pt-2 text-[11px] leading-snug text-fg-subtle">
        Grouped pins take the colour of the most severe incident inside them.
      </p>
    </div>
  );
}
