import type { LocationResult } from './store';

/**
 * Geocoding seam for the Bedrock Triage Agent (design doc §5.2, §5.5; CRIS-20).
 *
 * The Triage Agent (`agent.ts`) exposes a `geocode_location` tool it calls when
 * a report describes a place but no coordinates are known (§5.5). The tool
 * delegates to an injected {@link Geocoder}; the agent captures the resolved
 * coordinates out-of-band and persists them — the model never re-transcribes
 * lat/long (so a hallucinated coordinate can't leak into the map).
 *
 * BOUNDARY: CRIS-20 owns the agent's tool-use machinery and this seam. The real
 * Amazon Location Service place-index lookup + precision-7 geohash derivation is
 * CRIS-21's job: it adds `createAmazonLocationGeocoder(...)` here and flips
 * `GEOCODING_ENABLED` on. Until then the worker runs with {@link createNullGeocoder},
 * so the agent classifies normally and simply leaves location unresolved.
 */
export interface Geocoder {
  /**
   * Resolve a free-text location description to coordinates, or `null` when the
   * query can't be resolved / geocoding is not configured. MUST NOT throw for a
   * routine "no match" — reserve exceptions for genuine infra failures (the
   * agent treats a thrown geocode as "unavailable" and proceeds).
   */
  geocode(query: string): Promise<LocationResult | null>;
}

/**
 * A geocoder that resolves nothing — the CRIS-20 default while
 * `GEOCODING_ENABLED=false`. The agent still offers the `geocode_location` tool
 * (so the tool-use path is exercised) but every lookup returns "unavailable",
 * leaving the report unlocated until CRIS-21 wires Amazon Location.
 */
export function createNullGeocoder(): Geocoder {
  return {
    async geocode() {
      return null;
    },
  };
}
