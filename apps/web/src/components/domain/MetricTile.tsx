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
          className={cn('absolute inset-y-0 left-0 w-1 rounded-l-lg', accent)}
        />
      ) : null}
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{label}</span>
        {sublabel ? <span className="text-[11px] text-fg-subtle">{sublabel}</span> : null}
      </span>
      {count == null ? (
        <span
          aria-hidden="true"
          className="mt-1 block text-2xl font-semibold tabular text-fg-subtle"
        >
          —
        </span>
      ) : (
        <span className="mt-1 block text-2xl font-semibold tabular text-fg">{count}</span>
      )}
      {count == null ? <span className="sr-only">{emptyLabel}</span> : null}
    </>
  );

  const shell = cn(
    'relative block w-full overflow-hidden rounded-lg border bg-surface px-4 py-3 pl-5 text-left shadow-xs transition-colors',
    selected ? 'border-accent-border bg-accent-subtle' : 'border-border',
    onClick && 'hover:bg-surface-hover',
    className,
  );

  if (!onClick) return <div className={shell}>{body}</div>;

  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className={shell}>
      {body}
    </button>
  );
}
