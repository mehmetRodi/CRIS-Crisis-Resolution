import {
  AFFECTED_PEOPLE_MAX_POINTS,
  CATEGORY_MAX_POINTS,
  DUPLICATE_MAX_POINTS,
  RECENCY_MAX_POINTS,
  STALENESS_MAX_PENALTY,
  UNCERTAINTY_MAX_PENALTY,
  URGENCY_MAX_POINTS,
  VERIFICATION_MAX_POINTS,
  type ScoreBreakdown as ScoreBreakdownData,
} from '@crisismap/shared';

import { cn } from '../../lib/cn';

/**
 * "Why this ranks here" (design doc §5.4.2, CRIS-30).
 *
 * The product's central promise about priority is that it is deterministic and
 * EXPLAINABLE — never a raw model output. This panel is where that promise is
 * kept, so every factor renders proportionally against the points it can
 * contribute, and penalties render separately with a minus sign so the display
 * reads exactly like the stored v2 equation rather than a smoothed summary.
 *
 * The bars are `aria-hidden` and each row states its own numeric value in text.
 * A screen-reader user gets the exact contribution; a sighted user gets the
 * shape at a glance. Neither is served by announcing a decorative bar.
 */
const FACTORS: readonly { key: keyof ScoreBreakdownData; label: string; max: number }[] = [
  { key: 'urgencyWeight', label: 'Urgency', max: URGENCY_MAX_POINTS },
  { key: 'categoryWeight', label: 'Category', max: CATEGORY_MAX_POINTS },
  { key: 'affectedPeopleWeight', label: 'People affected', max: AFFECTED_PEOPLE_MAX_POINTS },
  { key: 'verificationWeight', label: 'Human verification', max: VERIFICATION_MAX_POINTS },
  { key: 'recencyWeight', label: 'Recency', max: RECENCY_MAX_POINTS },
  { key: 'duplicateWeight', label: 'Corroborating reports', max: DUPLICATE_MAX_POINTS },
];

/** Stored as positive magnitudes; they SUBTRACT from the score. */
const PENALTIES: readonly { key: keyof ScoreBreakdownData; label: string; max: number }[] = [
  { key: 'uncertaintyPenalty', label: 'Uncertainty', max: UNCERTAINTY_MAX_PENALTY },
  { key: 'stalenessPenalty', label: 'Staleness', max: STALENESS_MAX_PENALTY },
];

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function Row({
  label,
  value,
  max,
  penalty,
}: {
  label: string;
  value: number;
  max: number;
  penalty?: boolean;
}) {
  return (
    <li>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-fg-muted">{label}</span>
        <span className="tabular font-medium text-fg">
          {penalty ? '−' : '+'}
          {value.toFixed(2)}
        </span>
      </div>
      <div aria-hidden="true" className="mt-1 h-1.5 overflow-hidden rounded-sm bg-surface-sunken">
        <div
          className={cn('h-full rounded-sm', penalty ? 'bg-warning' : 'bg-accent')}
          style={{ width: `${clampPercent((value / max) * 100)}%` }}
        />
      </div>
    </li>
  );
}

export function ScoreBreakdown({ breakdown }: { breakdown: ScoreBreakdownData }) {
  return (
    <ul className="space-y-2">
      {FACTORS.map((factor) => (
        <Row
          key={factor.key}
          label={factor.label}
          value={breakdown[factor.key] as number}
          max={factor.max}
        />
      ))}
      {PENALTIES.map((factor) => (
        <Row
          key={factor.key}
          label={factor.label}
          value={breakdown[factor.key] as number}
          max={factor.max}
          penalty
        />
      ))}
    </ul>
  );
}
