import { GEOHASH_PRECISION } from './domain';

/**
 * Geohash encoding for resolved report locations (design doc §5.2).
 *
 * A geohash interleaves latitude/longitude bits into a base-32 string; each
 * added character refines the cell ~ ×8 in area. The classifier's geocode step
 * (CRIS-21) stores the precision-7 `geohash` (the map-viewport GSI sort key) and
 * its precision-5 `geohashPrefix` (the GSI partition key). Because DynamoDB has
 * no native radius query, a viewport request is decomposed into the bounded set
 * of prefixes it covers, each queried in parallel, then filtered exactly (§5.2).
 *
 * Lives in `@crisismap/shared` so the one encoder is shared by the geocoder
 * (Lambda) and the viewport-query path (CRIS-22) — the prefix that indexes a
 * report and the prefixes that fetch it must come from the same algorithm.
 */

/**
 * Precision of the `geohashPrefix` GSI partition key (~4.9 km × 4.9 km cell).
 * Coarser than {@link GEOHASH_PRECISION} so a viewport spans a small, bounded
 * number of partitions; a prefix is always the leading characters of the full
 * geohash, so `geohashPrefix === geohash.slice(0, GEOHASH_PREFIX_PRECISION)`.
 */
export const GEOHASH_PREFIX_PRECISION = 5;

/** Standard geohash base-32 alphabet (no a, i, l, o — avoids ambiguity). */
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Encode a WGS84 coordinate to a geohash of the given precision (default
 * {@link GEOHASH_PRECISION}). Throws {@link RangeError} for a non-finite or
 * out-of-range coordinate, or a non-positive-integer precision — a bad
 * coordinate must never be silently indexed at the wrong place on the map.
 */
export function encodeGeohash(lat: number, lng: number, precision = GEOHASH_PRECISION): string {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new RangeError(`latitude out of range: ${lat}`);
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new RangeError(`longitude out of range: ${lng}`);
  }
  if (!Number.isInteger(precision) || precision < 1) {
    throw new RangeError(`precision must be a positive integer: ${precision}`);
  }

  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let hash = '';
  let bits = 0; // count of bits accumulated into the current character (0..4)
  let value = 0; // the current 5-bit value being built
  let even = true; // even bits split longitude, odd bits split latitude

  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        value = value * 2 + 1;
        lngMin = mid;
      } else {
        value = value * 2;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        value = value * 2 + 1;
        latMin = mid;
      } else {
        value = value * 2;
        latMax = mid;
      }
    }
    even = !even;

    if (++bits === 5) {
      hash += BASE32[value];
      bits = 0;
      value = 0;
    }
  }

  return hash;
}

/**
 * The leading {@link GEOHASH_PREFIX_PRECISION} characters of a geohash — the GSI
 * partition key. A prefix must be derived from a geohash of at least that
 * precision (it never invents characters), so this throws if given a shorter one.
 */
export function geohashPrefix(geohash: string, length = GEOHASH_PREFIX_PRECISION): string {
  if (geohash.length < length) {
    throw new RangeError(`geohash "${geohash}" shorter than prefix length ${length}`);
  }
  return geohash.slice(0, length);
}

/** A WGS84 point, as decoded from a geohash. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * Decode a geohash back to its cell's center point — the inverse of
 * {@link encodeGeohash}, replaying the same even-bit-splits-longitude,
 * odd-bit-splits-latitude bisection. Used by the proximity-alert matcher
 * (CRIS-34) to recover an `AlertSubscription.centerGeohash` as a point for an
 * exact distance check (`distanceMeters`, `./duplicate.ts`). Throws on an
 * unrecognized character (a corrupt geohash must never silently resolve to
 * the wrong place).
 */
export function decodeGeohash(hash: string): GeoPoint {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let even = true;

  for (const char of hash) {
    const idx = BASE32.indexOf(char);
    if (idx === -1) throw new RangeError(`invalid geohash character: "${char}"`);
    for (let bitpos = 4; bitpos >= 0; bitpos--) {
      const bit = (idx >> bitpos) & 1;
      if (even) {
        const mid = (lngMin + lngMax) / 2;
        if (bit === 1) lngMin = mid;
        else lngMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (bit === 1) latMin = mid;
        else latMax = mid;
      }
      even = !even;
    }
  }

  return { lat: (latMin + latMax) / 2, lng: (lngMin + lngMax) / 2 };
}

