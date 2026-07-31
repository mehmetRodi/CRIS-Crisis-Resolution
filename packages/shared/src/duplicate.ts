import type { TriageEntities } from './classification';

/**
 * Conservative duplicate detection (design doc §5.4.3, CRIS-31).
 *
 * Nearby, recent reports of a compatible category are scored for similarity:
 *
 *     Ds = 0.40·L + 0.25·T + 0.20·G + 0.15·E
 *
 * `Ds ≥ 0.80` is a **strong** link (the reports are grouped under a shared
 * `duplicateGroupId`); `0.65 ≤ Ds < 0.80` is a **review suggestion** surfaced to
 * a coordinator. Reports are **grouped, never auto-deleted** — the grouping is a
 * pointer, and every original submission survives as evidence.
 *
 * Two deliberate constraints from the design doc:
 *
 * - **No embedding dependency.** Text similarity is keyword/entity overlap
 *   (Jaccard), not vectors — one less external service on the critical path,
 *   consistent with §1's "available even when a dependency is degraded".
 * - **Conservative by construction.** Every unknown resolves *away* from
 *   "duplicate". A missing location scores `L = 0`, which caps the total at
 *   0.60 — below the review threshold — so an unlocated report can never be
 *   auto-grouped. Wrongly merging two distinct emergencies loses an incident;
 *   failing to merge only costs a coordinator a second look.
 *
 * Lives in `@crisismap/shared` because the worker computes these scores and the
 * coordinator UI explains them: the score a reviewer sees must be the score that
 * grouped the report, from one implementation.
 *
 * > **Note on the formula's letters.** §5.4.3 states the weights but never
 * > expands `L`/`T`/`G`/`E`. They are read here as **L**ocation, **T**ext, time
 * > **G**ap, and **E**ntity — the only reading under which every concept the
 * > section names ("nearby", "recent", "text similarity", "entity overlap") is a
 * > scored component. See ADR-0037. If the author intended otherwise, the
 * > mapping is confined to {@link DUPLICATE_WEIGHTS} and the four
 * > `similarity*` functions.
 */

/* -------------------------------------------------------------------------- */
/* Tunable parameters                                                          */
/* -------------------------------------------------------------------------- */

/**
 * §5.4.3 component weights. They sum to 1, so `Ds` is always in [0, 1] and the
 * published thresholds keep their meaning. Changing any weight changes which
 * reports group — record it (it shifts coordinator workload and merge risk).
 */
export const DUPLICATE_WEIGHTS = {
  /** L — spatial proximity. Dominant: dedup is fundamentally "same place". */
  location: 0.4,
  /** T — free-text keyword overlap. */
  text: 0.25,
  /** G — closeness in submission time within the candidate window. */
  time: 0.2,
  /** E — overlap of AI-extracted entities (infrastructure, hazards). */
  entity: 0.15,
} as const;

/** `Ds ≥ 0.80` — group the reports under a shared `duplicateGroupId` (§5.4.3). */
export const DUPLICATE_STRONG_THRESHOLD = 0.8;

/** `Ds ≥ 0.65` — surface to a coordinator as a review suggestion, do not group. */
export const DUPLICATE_REVIEW_THRESHOLD = 0.65;

/**
 * Distance at which spatial similarity reaches 0. Not specified by §5.4.3;
 * chosen to sit between the precision-7 geohash cell (~153 m) and the
 * precision-5 candidate partition (~4.9 km), so candidates drawn from one
 * partition span the full range of `L` rather than clustering near 1.
 */
export const DUPLICATE_RADIUS_METERS = 2_000;

/**
 * Age difference at which temporal similarity reaches 0, and the candidate
 * window the worker queries. Not specified by §5.4.3; 60 minutes matches the
 * span over which independent reports of one incident realistically arrive.
 */
export const DUPLICATE_WINDOW_MINUTES = 60;

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/** Outcome of comparing two reports (§5.4.3). */
export const DuplicateVerdict = {
  /** `Ds ≥ 0.80` — strong link; share a `duplicateGroupId`. */
  STRONG: 'STRONG',
  /** `0.65 ≤ Ds < 0.80` — suggest to a coordinator; do not group automatically. */
  REVIEW: 'REVIEW',
  /** Below 0.65, or gated out by category. Treated as unrelated. */
  DISTINCT: 'DISTINCT',
} as const;

export type DuplicateVerdict = (typeof DuplicateVerdict)[keyof typeof DuplicateVerdict];

/** The facts about a report needed to score it against another. */
export interface DuplicateSubject {
  /** Classified category. Incompatible categories are gated out before scoring. */
  category: string;
  /** Resolved latitude, when geocoding succeeded (CRIS-21). */
  lat?: number | null;
  /** Resolved longitude, when geocoding succeeded. */
  lng?: number | null;
  /** ISO-8601 submit time. */
  createdAt: string;
  /** Raw report text — used for keyword overlap only, never persisted here. */
  text?: string | null;
  /** AI-extracted entities (CRIS-20). */
  entities?: TriageEntities | null;
}

/** Per-component breakdown, so a coordinator can see *why* two reports linked. */
export interface DuplicateComponents {
  location: number;
  text: number;
  time: number;
  entity: number;
}

export interface DuplicateSimilarity {
  /** `Ds` in [0, 1], rounded to 2dp. */
  score: number;
  verdict: DuplicateVerdict;
  components: DuplicateComponents;
}

/* -------------------------------------------------------------------------- */
/* Component similarities                                                      */
/* -------------------------------------------------------------------------- */

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Great-circle distance in metres between two WGS84 coordinates (haversine).
 * Exported because the worker's candidate filter needs the same measure the
 * score uses.
 */
export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);
  const lat1 = toRadians(aLat);
  const lat2 = toRadians(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * `L` — linear falloff from 1 (same point) to 0 at
 * {@link DUPLICATE_RADIUS_METERS}. Returns 0 when either report is unlocated:
 * an unknown location is not evidence of sameness (§5.4.3, conservative).
 */
export function similarityLocation(a: DuplicateSubject, b: DuplicateSubject): number {
  if (
    typeof a.lat !== 'number' ||
    typeof a.lng !== 'number' ||
    typeof b.lat !== 'number' ||
    typeof b.lng !== 'number'
  ) {
    return 0;
  }
  const d = distanceMeters(a.lat, a.lng, b.lat, b.lng);
  return clamp01(1 - d / DUPLICATE_RADIUS_METERS);
}

/**
 * `G` — linear falloff from 1 (simultaneous) to 0 at
 * {@link DUPLICATE_WINDOW_MINUTES}. An unparseable timestamp scores 0.
 */
export function similarityTime(a: DuplicateSubject, b: DuplicateSubject): number {
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  const minutes = Math.abs(ta - tb) / 60_000;
  return clamp01(1 - minutes / DUPLICATE_WINDOW_MINUTES);
}

/**
 * Very common words carry no signal about *which* incident a report describes,
 * and would inflate overlap between any two reports. Deliberately short — an
 * aggressive stoplist risks dropping meaningful emergency vocabulary.
 */
const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'are',
  'but',
  'not',
  'you',
  'all',
  'can',
  'her',
  'his',
  'its',
  'our',
  'out',
  'has',
  'have',
  'was',
  'were',
  'with',
  'this',
  'that',
  'from',
  'they',
  'them',
  'there',
  'here',
  'been',
  'near',
  'about',
  'into',
  'over',
  'some',
  'more',
  'very',
  'need',
  'needs',
  'please',
  'help',
]);

/** Lowercase, strip punctuation, drop short tokens and stopwords. */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

/**
 * Jaccard index |A∩B| / |A∪B|. Two empty sets score 0, not 1 — "we know nothing
 * about either" must not read as "these are identical".
 */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

/**
 * `T` — keyword overlap between the two report bodies. §5.4.3 mandates
 * keyword/entity overlap for MVP specifically to avoid an embedding dependency.
 */
export function similarityText(a: DuplicateSubject, b: DuplicateSubject): number {
  if (!a.text || !b.text) return 0;
  return jaccard(tokenize(a.text), tokenize(b.text));
}

/** Flattens the string-valued entity fields into one normalized token set. */
function entityTokens(entities: TriageEntities | null | undefined): Set<string> {
  if (!entities) return new Set();
  const tokens = new Set<string>();
  for (const value of [...entities.infrastructure, ...entities.hazards]) {
    const normalized = value.toLowerCase().trim();
    if (normalized) tokens.add(normalized);
  }
  return tokens;
}

/**
 * `E` — overlap of AI-extracted infrastructure and hazards. `peopleAffected` is
 * excluded deliberately: it is a magnitude estimate, and two reports agreeing
 * that "about 20" people are affected is far weaker evidence of sameness than
 * both naming "north bridge".
 */
export function similarityEntity(a: DuplicateSubject, b: DuplicateSubject): number {
  return jaccard(entityTokens(a.entities), entityTokens(b.entities));
}

/* -------------------------------------------------------------------------- */
/* Composite score                                                             */
/* -------------------------------------------------------------------------- */

/**
 * True when two categories are close enough to be the same incident. MVP rule:
 * identical categories only. §5.4.3 says "compatible category" without defining
 * a compatibility matrix, and the conservative reading of an undefined relation
 * is the strictest one — a cross-category matrix can be added once the taxonomy
 * settles, and only ever widens what groups.
 */
export function isCompatibleCategory(a: string, b: string): boolean {
  return a === b;
}

/** Maps a raw `Ds` onto the §5.4.3 bands. */
export function verdictForScore(score: number): DuplicateVerdict {
  if (score >= DUPLICATE_STRONG_THRESHOLD) return DuplicateVerdict.STRONG;
  if (score >= DUPLICATE_REVIEW_THRESHOLD) return DuplicateVerdict.REVIEW;
  return DuplicateVerdict.DISTINCT;
}

/**
 * Score one candidate pair per §5.4.3. Incompatible categories short-circuit to
 * a zero score rather than being scored and rejected — the category gate is a
 * precondition, not a weighted term, so it must not be softenable by a very
 * close location.
 */
export function scoreDuplicate(a: DuplicateSubject, b: DuplicateSubject): DuplicateSimilarity {
  if (!isCompatibleCategory(a.category, b.category)) {
    return {
      score: 0,
      verdict: DuplicateVerdict.DISTINCT,
      components: { location: 0, text: 0, time: 0, entity: 0 },
    };
  }

  const components: DuplicateComponents = {
    location: similarityLocation(a, b),
    text: similarityText(a, b),
    time: similarityTime(a, b),
    entity: similarityEntity(a, b),
  };

  const raw =
    DUPLICATE_WEIGHTS.location * components.location +
    DUPLICATE_WEIGHTS.text * components.text +
    DUPLICATE_WEIGHTS.time * components.time +
    DUPLICATE_WEIGHTS.entity * components.entity;

  const score = round2(clamp01(raw));
  return {
    score,
    verdict: verdictForScore(score),
    components: {
      location: round2(components.location),
      text: round2(components.text),
      time: round2(components.time),
      entity: round2(components.entity),
    },
  };
}

/** A scored candidate, carrying the id so the caller can act on the winner. */
export interface DuplicateMatch extends DuplicateSimilarity {
  reportId: string;
  /** The candidate's existing group, when it already belongs to one. */
  duplicateGroupId?: string | null;
}

/**
 * Scores every candidate against `subject` and returns them strongest-first.
 * Ties break on `reportId` so the result is deterministic — the same candidate
 * set must always produce the same grouping, whatever order DynamoDB returned.
 */
export function rankDuplicates(
  subject: DuplicateSubject,
  candidates: (DuplicateSubject & { reportId: string; duplicateGroupId?: string | null })[],
): DuplicateMatch[] {
  return candidates
    .map((candidate) => ({
      ...scoreDuplicate(subject, candidate),
      reportId: candidate.reportId,
      duplicateGroupId: candidate.duplicateGroupId ?? null,
    }))
    .filter((match) => match.verdict !== DuplicateVerdict.DISTINCT)
    .sort((x, y) => y.score - x.score || x.reportId.localeCompare(y.reportId));
}
