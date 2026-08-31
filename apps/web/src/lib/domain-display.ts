import {
  AssignmentStatus,
  Category,
  PriorityBand,
  ReportStatus,
  UserRole,
} from '@crisismap/shared';
import {
  ASSIGNMENT_STATUS_LABELS,
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  ROLE_LABELS,
  STATUS_LABELS,
  UNSCORED_LABEL,
  URGENCY_LABELS,
  categoryLabel,
  priorityLabel,
  roleLabel,
  statusLabel,
  urgencyLabel,
  type PriorityLabel,
  type StatusLabel,
  type Tone,
} from '@crisismap/design';
import {
  Biohazard,
  Building2,
  CircleHelp,
  Flame,
  HeartPulse,
  LifeBuoy,
  Tent,
  TrafficCone,
  Waves,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import type { BadgeVariant } from '../components/ui/badge';

/**
 * The WEB half of the domain presentation layer (CRIS-54, refactored in
 * CRIS-57).
 *
 * The wording — every label, description, and colour intent — now lives in
 * `@crisismap/design` so the Expo app renders the same words (ADR-0057). This
 * module adds only what cannot cross the platform boundary: `lucide-react`
 * icons and Tailwind class names.
 *
 * Nothing here may change behaviour. `@crisismap/shared` keeps the vocabulary
 * and the authority; this is presentation.
 */

/* Re-exported so surfaces import their display vocabulary from one module,
   rather than splitting imports between the design package and this one. */
export {
  ASSIGNMENT_STATUS_LABELS,
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  ROLE_LABELS,
  STATUS_LABELS,
  UNSCORED_LABEL,
  URGENCY_LABELS,
  roleLabel,
  statusLabel,
  urgencyLabel,
};
export type { PriorityLabel, StatusLabel, Tone };

/**
 * A shared colour INTENT resolved to this app's badge variant.
 *
 * The design package deliberately ships intents rather than colours, because
 * React Native cannot use a Tailwind class and the web cannot use a
 * `StyleSheet` object. This is the web's half of that contract; the total
 * `Record` makes a new intent a compile error here rather than an untinted
 * badge at runtime.
 */
const TONE_BADGE: Readonly<Record<Tone, BadgeVariant>> = {
  neutral: 'neutral',
  accent: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
  p0: 'p0',
  p1: 'p1',
  p2: 'p2',
  p3: 'p3',
  unscored: 'unscored',
};

export function toneBadge(tone: Tone): BadgeVariant {
  return TONE_BADGE[tone];
}

/* -------------------------------------------------------------------------- */
/* Priority bands                                                             */
/* -------------------------------------------------------------------------- */

export interface PriorityMeta extends PriorityLabel {
  badge: BadgeVariant;
  /** Tailwind text colour, for marker glyphs and bare numerals. */
  fg: string;
  /** Tailwind background, for solid map markers and legend swatches. */
  solid: string;
  /** Resolved CSS colour, for canvas contexts (MapLibre) that cannot use classes. */
  cssVar: string;
}

/** Web styling for each band, keyed to the shared wording. */
const BAND_STYLE: Readonly<Record<PriorityBand, { fg: string; solid: string; cssVar: string }>> = {
  [PriorityBand.P0]: {
    fg: 'text-severity-p0',
    solid: 'bg-severity-p0',
    cssVar: 'hsl(var(--severity-p0))',
  },
  [PriorityBand.P1]: {
    fg: 'text-severity-p1',
    solid: 'bg-severity-p1',
    cssVar: 'hsl(var(--severity-p1))',
  },
  [PriorityBand.P2]: {
    fg: 'text-severity-p2',
    solid: 'bg-severity-p2',
    cssVar: 'hsl(var(--severity-p2))',
  },
  [PriorityBand.P3]: {
    fg: 'text-severity-p3',
    solid: 'bg-severity-p3',
    cssVar: 'hsl(var(--severity-p3))',
  },
};

export const PRIORITY_META: Readonly<Record<PriorityBand, PriorityMeta>> = Object.fromEntries(
  (Object.keys(PRIORITY_LABELS) as PriorityBand[]).map((band) => [
    band,
    { ...PRIORITY_LABELS[band], badge: toneBadge(PRIORITY_LABELS[band].tone), ...BAND_STYLE[band] },
  ]),
) as Record<PriorityBand, PriorityMeta>;

/**
 * The presentation for an incident with NO band yet (NEW / PROCESSING).
 *
 * Distinct from P3 on purpose: "not scored yet" is a different claim from
 * "scored lowest". Rendering an unclassified report as P3 would tell a
 * coordinator the AI had assessed it and found it routine — the opposite of the
 * truth (§2.6).
 */
export const UNSCORED_META: PriorityMeta = {
  ...UNSCORED_LABEL,
  badge: toneBadge(UNSCORED_LABEL.tone),
  fg: 'text-severity-none',
  solid: 'bg-severity-none',
  cssVar: 'hsl(var(--severity-none))',
};

/** Presentation for `band`, falling back to the unscored treatment for `null`. */
export function priorityMeta(band: PriorityBand | null | undefined): PriorityMeta {
  return band ? PRIORITY_META[band] : UNSCORED_META;
}

/* -------------------------------------------------------------------------- */
/* Report status                                                              */
/* -------------------------------------------------------------------------- */

export interface StatusMeta extends StatusLabel {
  badge: BadgeVariant;
}

export const STATUS_META: Readonly<Record<ReportStatus, StatusMeta>> = Object.fromEntries(
  (Object.keys(STATUS_LABELS) as ReportStatus[]).map((status) => [
    status,
    { ...STATUS_LABELS[status], badge: toneBadge(STATUS_LABELS[status].tone) },
  ]),
) as Record<ReportStatus, StatusMeta>;

export function statusMeta(status: ReportStatus): StatusMeta {
  return STATUS_META[status];
}

/* -------------------------------------------------------------------------- */
/* Category                                                                   */
/* -------------------------------------------------------------------------- */

export interface CategoryMeta {
  label: string;
  icon: LucideIcon;
}

/**
 * Categories carry an ICON but deliberately no colour of their own.
 *
 * Colour in this product means severity, everywhere, without exception. Giving
 * ten categories ten more hues would put two competing colour languages on the
 * same map, and the one that matters — how urgent is this — would lose.
 *
 * The icon names here are matched exactly by the Expo app's own map, so the two
 * clients show the same glyph for the same category.
 */
const CATEGORY_ICON: Readonly<Record<Category, LucideIcon>> = {
  [Category.MEDICAL]: HeartPulse,
  [Category.RESCUE]: LifeBuoy,
  [Category.STRUCTURAL_DAMAGE]: Building2,
  [Category.FIRE]: Flame,
  [Category.FLOOD]: Waves,
  [Category.HAZMAT]: Biohazard,
  [Category.BLOCKED_ROAD]: TrafficCone,
  [Category.SHELTER]: Tent,
  [Category.UTILITY]: Zap,
  [Category.OTHER]: CircleHelp,
};

export const CATEGORY_META: Readonly<Record<Category, CategoryMeta>> = Object.fromEntries(
  (Object.keys(CATEGORY_LABELS) as Category[]).map((category) => [
    category,
    { label: CATEGORY_LABELS[category], icon: CATEGORY_ICON[category] },
  ]),
) as Record<Category, CategoryMeta>;

export function categoryMeta(category: Category | null | undefined): CategoryMeta {
  return category ? CATEGORY_META[category] : { label: categoryLabel(category), icon: CircleHelp };
}

/* -------------------------------------------------------------------------- */
/* Assignment status                                                          */
/* -------------------------------------------------------------------------- */

export const ASSIGNMENT_STATUS_META: Readonly<
  Record<AssignmentStatus, { label: string; badge: BadgeVariant }>
> = Object.fromEntries(
  (Object.keys(ASSIGNMENT_STATUS_LABELS) as AssignmentStatus[]).map((status) => [
    status,
    {
      label: ASSIGNMENT_STATUS_LABELS[status].label,
      badge: toneBadge(ASSIGNMENT_STATUS_LABELS[status].tone),
    },
  ]),
) as Record<AssignmentStatus, { label: string; badge: BadgeVariant }>;

/* -------------------------------------------------------------------------- */
/* Roles                                                                      */
/* -------------------------------------------------------------------------- */

/** Kept as a distinct export because surfaces read `ROLE_META[role].description`. */
export const ROLE_META: Readonly<Record<UserRole, { label: string; description: string }>> =
  ROLE_LABELS;

/* `priorityLabel` is re-exported for parity with the design package, though web
   surfaces normally want `priorityMeta` (which carries the styling too). */
export { priorityLabel, categoryLabel };
