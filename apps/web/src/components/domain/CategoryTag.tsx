import type { Category } from '@crisismap/shared';

import { cn } from '../../lib/cn';
import { categoryMeta } from '../../lib/domain-display';

/**
 * Category icon + label. The icon is decorative — the label beside it is the
 * real content, so the glyph is hidden rather than given its own name (which
 * would make a screen reader announce the category twice).
 */
export function CategoryTag({
  category,
  className,
  iconOnly = false,
}: {
  category: Category | null | undefined;
  className?: string;
  /** Icon alone, with the label moved into the accessible name. */
  iconOnly?: boolean;
}) {
  const { label, icon: Icon } = categoryMeta(category);
  if (iconOnly) {
    return (
      <span className={cn('inline-flex text-fg-muted', className)} title={label}>
        <Icon className="size-4" aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-fg-muted', className)}>
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </span>
  );
}
