import { cn } from '../../lib/cn';

/**
 * A single counter in the metrics strip.
 *
 * The `accent` rail is a left border rather than a tinted background: at four
 * tiles wide, four filled severity backgrounds turn the top of the workspace
 * into a colour block that outweighs the map beneath it. The rail carries the
 * same information at a fraction of the visual weight.
 *
 * When `count` is `null` the tile shows an em-dash and hides it from the
 * accessibility tree, with the real state carried by `emptyLabel` — otherwise a
 * screen reader announces "Critical, dash", which sounds like a value of zero.
 */
export function MetricTile({
  label,
  sublabel,
  count,
  accent,
  emptyLabel = 'not loaded',
  selected = false,
  onClick,
  className,
}: {
  label: string;
  sublabel?: string;
  count: number | null;
  /** Tailwind background class for the left rail (a severity token). */
  accent?: string;
  emptyLabel?: string;
  selected?: boolean;
  /** When given, the tile becomes a filter toggle for its band. */
  onClick?: () => void;
  className?: string;
}) {
  const body = (
    <>
      {accent ? (
        <span
          aria-hidden="true"
          className={cn('absolute inset-y-0 left-0 w-1.5 rounded-l-xl', accent)}
        />
      ) : null}
      <span className="flex items-baseline justify-between gap-1">
        <span className="text-xs font-bold uppercase tracking-wide text-fg-muted">{label}</span>
        {sublabel ? <span className="text-[10px] font-medium text-fg-subtle">{sublabel}</span> : null}
      </span>
      {count == null ? (
        <span
          aria-hidden="true"
          className="mt-1 block text-2xl font-bold tabular text-fg-subtle"
        >
          —
        </span>
      ) : (
        <span className="mt-1 block text-2xl font-bold tabular text-fg tracking-tight">{count}</span>
      )}
      {count == null ? <span className="sr-only">{emptyLabel}</span> : null}
    </>
  );

  const shell = cn(
    'relative block w-full overflow-hidden rounded-xl border px-3.5 py-2.5 pl-4 text-left shadow-2xs transition-all duration-150',
    selected ? 'border-accent bg-accent/10 ring-2 ring-accent/20 shadow-xs' : 'border-border/80 bg-surface',
    onClick && 'hover:bg-surface-hover hover:border-border hover:shadow-xs active:scale-[0.98]',
    className,
  );

  if (!onClick) return <div className={shell}>{body}</div>;

  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className={shell}>
      {body}
    </button>
  );
}
