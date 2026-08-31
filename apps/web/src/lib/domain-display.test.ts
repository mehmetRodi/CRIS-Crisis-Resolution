import { describe, expect, it } from 'vitest';
import { AssignmentStatus, Category, PriorityBand, ReportStatus } from '@crisismap/shared';
import { PRIORITY_LABELS, STATUS_LABELS, type Tone } from '@crisismap/design';

import {
  ASSIGNMENT_STATUS_META,
  CATEGORY_META,
  PRIORITY_META,
  STATUS_META,
  UNSCORED_META,
  categoryMeta,
  priorityMeta,
  toneBadge,
} from './domain-display';

/**
 * The WEB half of the presentation layer (CRIS-57).
 *
 * Label wording is owned and tested by `@crisismap/design`; duplicating those
 * assertions here would just make the same change fail twice. What this file
 * covers is the part that cannot cross the platform boundary: that every shared
 * colour intent resolves to a badge variant, that every category has an icon,
 * and that the shared wording actually reaches the web objects.
 */
describe('toneBadge', () => {
  it('resolves every tone the design package can emit', () => {
    // A `Record<Tone, …>` makes a NEW tone a compile error, but this catches the
    // runtime half: an intent that maps to `undefined` renders an untinted badge
    // rather than failing.
    const tones: Tone[] = [
      'neutral',
      'accent',
      'success',
      'warning',
      'danger',
      'info',
      'p0',
      'p1',
      'p2',
      'p3',
      'unscored',
    ];
    for (const tone of tones) expect(toneBadge(tone), tone).toBeTruthy();
  });
});

describe('PRIORITY_META', () => {
  it('carries the shared wording through to the web object', () => {
    // If this drifts, the two clients describe the same band differently.
    for (const band of Object.values(PriorityBand)) {
      expect(PRIORITY_META[band].label).toBe(PRIORITY_LABELS[band].label);
      expect(PRIORITY_META[band].description).toBe(PRIORITY_LABELS[band].description);
    }
  });

  it('gives every band a distinct badge, class, and canvas colour', () => {
    const bands = Object.values(PriorityBand);
    const cssVars = bands.map((band) => PRIORITY_META[band].cssVar);
    expect(new Set(cssVars).size).toBe(bands.length);
    for (const band of bands) {
      expect(PRIORITY_META[band].solid).toMatch(/^bg-severity-/);
      expect(PRIORITY_META[band].fg).toMatch(/^text-severity-/);
    }
  });

  it('resolves canvas colours through a token, never a literal', () => {
    // MapLibre paints to WebGL and cannot read a class, but hard-coding a hex
    // would drift from `tokens.css` the first time the palette changes.
    for (const band of Object.values(PriorityBand)) {
      expect(PRIORITY_META[band].cssVar).toMatch(/^hsl\(var\(--severity-/);
    }
  });
});

describe('UNSCORED_META', () => {
  it('is visually distinct from P3 in every channel', () => {
    // "Not assessed" is not "ranks lowest". Colouring them alike would tell a
    // coordinator the AI reviewed an incident and found it routine.
    const p3 = PRIORITY_META[PriorityBand.P3];
    expect(UNSCORED_META.badge).not.toBe(p3.badge);
    expect(UNSCORED_META.cssVar).not.toBe(p3.cssVar);
    expect(UNSCORED_META.solid).not.toBe(p3.solid);
  });
});

describe('priorityMeta', () => {
  it('falls back to the unscored treatment for a null band', () => {
    expect(priorityMeta(null)).toBe(UNSCORED_META);
    expect(priorityMeta(PriorityBand.P0)).toBe(PRIORITY_META[PriorityBand.P0]);
  });
});

describe('STATUS_META', () => {
  it('carries the shared wording and resolves each tone to a badge', () => {
    for (const status of Object.values(ReportStatus)) {
      expect(STATUS_META[status].label).toBe(STATUS_LABELS[status].label);
      expect(STATUS_META[status].badge).toBe(toneBadge(STATUS_LABELS[status].tone));
    }
  });
});

describe('CATEGORY_META', () => {
  it('gives every category an icon', () => {
    for (const category of Object.values(Category)) {
      expect(CATEGORY_META[category].icon, category).toBeTruthy();
    }
  });

  it('assigns no colour to any category', () => {
    // Colour means severity, everywhere. Two competing colour languages on the
    // same map would cost the one that matters (ADR-0054).
    for (const category of Object.values(Category)) {
      expect(Object.keys(CATEGORY_META[category]).sort()).toEqual(['icon', 'label']);
    }
  });

  it('falls back to a named, icon-bearing treatment for an unclassified report', () => {
    expect(categoryMeta(null).label).toBe('Unclassified');
    expect(categoryMeta(null).icon).toBeTruthy();
  });
});

describe('ASSIGNMENT_STATUS_META', () => {
  it('resolves every assignment status to a badge', () => {
    for (const status of Object.values(AssignmentStatus)) {
      expect(ASSIGNMENT_STATUS_META[status].badge, status).toBeTruthy();
    }
  });
});
