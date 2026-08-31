import { Category } from '@crisismap/shared';
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
} from 'lucide-react-native';

import { colors } from '../theme';

/**
 * The MOBILE half of the domain presentation layer (CRIS-57, ADR-0057).
 *
 * Mirror of `apps/web/src/lib/domain-display.ts`. The wording — every label and
 * description — comes from `@crisismap/design`, so both clients call the same
 * status by the same name. This module adds only what cannot cross the platform
 * boundary: `lucide-react-native` icons and resolved colour values.
 *
 * The icon assignments below match the web module's exactly, so the same
 * category shows the same glyph on both clients.
 */

export {
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
};
export type { Tone };

/** Resolved colours for one tone: a tinted fill, a matching border, and text. */
export interface ToneStyle {
  background: string;
  border: string;
  foreground: string;
}

/**
 * A shared colour INTENT resolved to this platform's actual colours.
 *
 * Every variant pairs a tinted fill with dark text rather than white-on-
 * saturated, matching web: at badge size a saturated fill competes with the
 * severity signals around it, and a column of them becomes unreadable.
 *
 * A total `Record<Tone, …>` means a new intent added to the design package is a
 * compile error here, rather than an untinted badge at runtime.
 */
const TONE_STYLES: Readonly<Record<Tone, ToneStyle>> = {
  neutral: {
    background: colors.surfaceSunken,
    border: colors.border,
    foreground: colors.fgMuted,
  },
  accent: {
    background: colors.accentSubtle,
    border: colors.accentBorder,
    foreground: colors.accentSubtleFg,
  },
  success: {
    background: colors.successSubtle,
    border: colors.successBorder,
    foreground: colors.success,
  },
  warning: {
    background: colors.warningSubtle,
    border: colors.warningBorder,
    foreground: colors.warning,
  },
  danger: {
    background: colors.dangerSubtle,
    border: colors.dangerBorder,
    foreground: colors.danger,
  },
  info: {
    background: colors.infoSubtle,
    border: colors.infoBorder,
    foreground: colors.info,
  },
  p0: {
    background: colors.severity.p0Subtle,
    border: colors.severity.p0Border,
    foreground: colors.severity.p0,
  },
  p1: {
    background: colors.severity.p1Subtle,
    border: colors.severity.p1Border,
    foreground: colors.severity.p1,
  },
  p2: {
    background: colors.severity.p2Subtle,
    border: colors.severity.p2Border,
    foreground: colors.severity.p2,
  },
  p3: {
    background: colors.severity.p3Subtle,
    border: colors.severity.p3Border,
    foreground: colors.severity.p3,
  },
  // Deliberately not P3's colours: "not yet assessed" is a different claim from
  // "ranks lowest", and no surface may imply the AI has already judged it.
  unscored: {
    background: colors.severity.noneSubtle,
    border: colors.severity.noneBorder,
    foreground: colors.severity.none,
  },
};

export function toneStyle(tone: Tone): ToneStyle {
  return TONE_STYLES[tone];
}

/**
 * Category icons. Categories carry an icon but no colour of their own: colour
 * in this product means severity, everywhere, and a second colour language
 * would cost the one that matters.
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

export function categoryIcon(category: Category | null | undefined): LucideIcon {
  return category ? CATEGORY_ICON[category] : CircleHelp;
}
