import type { ReportStatus } from '@crisismap/shared';

import { Badge } from '../ui/badge';
import { statusMeta } from '../../lib/domain-display';

/**
 * Report lifecycle chip. Renders the human label, never the raw
 * `SCREAMING_SNAKE` enum — citizens see this on their own report, and
 * "NEEDS_VERIFICATION" is not something to show a person in an emergency.
 */
export function StatusBadge({ status, className }: { status: ReportStatus; className?: string }) {
  const meta = statusMeta(status);
  return (
    <Badge variant={meta.badge} className={className} title={meta.description}>
      {meta.label}
    </Badge>
  );
}
