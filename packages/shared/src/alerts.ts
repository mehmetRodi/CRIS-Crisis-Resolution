import { decodeGeohash } from './geohash';
import { distanceMeters } from './duplicate';
import { PriorityBand, Urgency, type Category } from './domain';

/**
 * Proximity-alert matching (design doc §2.7, §5, Fig 10; CRIS-34).
 *
 * A just-classified report becomes an `AlertCandidate` — the PII-free subset
 * of its fields an `AlertSubscription` can be matched against — and this
 * module's `matchesSubscription` is the pure eligibility check the dispatch
 * worker runs per candidate subscription. Candidates are narrowed to a
 * manageable set before this runs via two independent DynamoDB lookups —
 * `subscriptionsByRegion` (the candidate's `regionId`) and
 * `subscriptionsByGeohashPrefix` (the candidate's `geohashPrefix`) — merged by
 * the caller, since a subscription may set a region, a geofence, or both, and
 * a report may carry a region, a location, both, or (today, in practice)
 * neither. Kept framework-free, like `duplicate.ts`, so the matching rule the
 * worker applies and the rule a test asserts are the same implementation.
 *
 * **Conservative by construction**, matching this codebase's existing dedup
 * philosophy: an unknown candidate field that a subscription's filter depends
 * on resolves to "does not match", never "matches". Missing a citizen an
 * alert should have reached is a smaller failure than alerting on data the
 * system can't actually confirm.
 */

/** Only reports at least this urgent enqueue an alert at all (CRIS-34). */
export const ALERT_TRIGGER_BANDS: readonly PriorityBand[] = [PriorityBand.P0, PriorityBand.P1];

/** The PII-free fields of a just-classified report a subscription is matched against. */
export interface AlertCandidate {
  reportId: string;
  category: Category | null;
  urgency: Urgency | null;
  priorityBand: PriorityBand;
  regionId: string | null;
  lat: number | null;
  lng: number | null;
  /** Precision-5 prefix of the resolved location's geohash, if any (§5.2). */
  geohashPrefix: string | null;
}

/**
 * The subset of `AlertSubscription` fields matching depends on. Structural
 * (not the generated Amplify `Schema` type), mirroring `RawReportEvent`
 * elsewhere in this codebase — the dispatch worker's AppSync/DynamoDB records
 * are assignable to this shape.
 */
export interface AlertSubscriptionFilter {
  active: boolean | null;
  categories: readonly string[] | null;
  minUrgency: Urgency | null;
  centerGeohash: string | null;
  radiusMeters: number | null;
}

const URGENCY_RANK: readonly Urgency[] = [
  Urgency.LOW,
  Urgency.MEDIUM,
  Urgency.HIGH,
  Urgency.CRITICAL,
];

/** True when `urgency` meets or exceeds `minUrgency` on the LOW→CRITICAL scale. */
function meetsMinUrgency(urgency: Urgency, minUrgency: Urgency): boolean {
  return URGENCY_RANK.indexOf(urgency) >= URGENCY_RANK.indexOf(minUrgency);
}

/**
 * Whether `subscription` should receive an alert for `candidate`. Callers are
 * expected to have already narrowed candidates via `subscriptionsByRegion`
 * and/or `subscriptionsByGeohashPrefix` (see the module doc) — this function
 * only applies the finer-grained filters (category, urgency, exact geofence
 * distance) to whatever candidate set the caller already assembled.
 */
export function matchesSubscription(
  subscription: AlertSubscriptionFilter,
  candidate: AlertCandidate,
): boolean {
  if (subscription.active === false) return false;

  if (subscription.categories && subscription.categories.length > 0) {
    if (!candidate.category || !subscription.categories.includes(candidate.category)) {
      return false;
    }
  }

  if (subscription.minUrgency) {
    if (!candidate.urgency || !meetsMinUrgency(candidate.urgency, subscription.minUrgency)) {
      return false;
    }
  }

  if (subscription.centerGeohash && subscription.radiusMeters != null) {
    if (candidate.lat == null || candidate.lng == null) return false;
    const center = decodeGeohash(subscription.centerGeohash);
    if (distanceMeters(center.lat, center.lng, candidate.lat, candidate.lng) > subscription.radiusMeters) {
      return false;
    }
  }

  return true;
}
