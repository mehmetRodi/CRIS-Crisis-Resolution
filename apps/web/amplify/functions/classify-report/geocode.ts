import {
  GeocodeCommand,
  GeocodeIntendedUse,
  GeoPlacesClient,
  type GeocodeCommandOutput,
} from '@aws-sdk/client-geo-places';
import { encodeGeohash, geohashPrefix, GEOHASH_PRECISION } from '@crisismap/shared';
import type { LocationResult } from './store';

/**
 * Amazon Location geocoding for the Bedrock Triage Agent (design doc §5.2, §5.5;
 * CRIS-21).
 *
 * The Triage Agent (`agent.ts`) exposes a `geocode_location` tool it calls when
 * a report describes a place but no coordinates are known (§5.5). The tool
 * delegates to an injected {@link Geocoder}; the agent captures the resolved
 * coordinates out-of-band and persists them — the model never re-transcribes
 * lat/long (so a hallucinated coordinate can't leak into the map).
 *
 * {@link createAmazonLocationGeocoder} is the real implementation: it resolves
 * the free-text query with the Amazon Location **Places** `Geocode` API and
 * derives the precision-7 `geohash` + precision-5 `geohashPrefix` locally
 * (`@crisismap/shared`), so the coordinate that indexes a report and the
 * prefixes that later fetch it (CRIS-22 viewport queries) come from one encoder.
 * When `GEOCODING_ENABLED=false` the worker uses {@link createNullGeocoder}
 * instead and reports stay unlocated. See ADR-0027.
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
 * A geocoder that resolves nothing — used while `GEOCODING_ENABLED=false`. The
 * agent still offers the `geocode_location` tool (so the tool-use path is
 * exercised) but every lookup returns "unavailable", leaving the report
 * unlocated. This is also the safe degraded mode if the place API is disabled.
 */
export function createNullGeocoder(): Geocoder {
  return {
    async geocode() {
      return null;
    },
  };
}

/**
 * Minimum overall match confidence (0..1) required to accept a geocode result.
 * Placing a map pin in the wrong place is worse than leaving a report unlocated
 * (a coordinator can still triage from the text), so a weak match is discarded
 * as "no match" rather than trusted. Results without a numeric score (some place
 * types omit it) are accepted — the score is a guard, not a hard requirement.
 */
const MIN_MATCH_SCORE = 0.5;

/** Minimal `send`-able client surface — lets tests inject a fake with no AWS SDK. */
export interface GeoPlacesSend {
  send(command: GeocodeCommand): Promise<GeocodeCommandOutput>;
}

export interface AmazonLocationGeocoderConfig {
  /** Injected client (tests). Defaults to a real {@link GeoPlacesClient}. */
  client?: GeoPlacesSend;
  /** Overrides the top-result match-confidence floor. */
  minMatchScore?: number;
  /** Structured-log sink; defaults to no-op. */
  log?: (entry: Record<string, unknown>) => void;
}

/**
 * A {@link Geocoder} backed by the Amazon Location Places `Geocode` API.
 *
 * Design points (ADR-0027):
 *   - **`IntendedUse: Storage`** — the resolved coordinate is persisted in
 *     DynamoDB (system of record), which the AWS terms classify as storage, not
 *     ephemeral display.
 *   - **`MaxResults: 1`** — the agent already chose to geocode a single
 *     described place; we take the single best match, gated by
 *     {@link MIN_MATCH_SCORE}.
 *   - **`Position` is `[lng, lat]`** (WGS84 / GeoJSON order) — do not swap.
 *   - **Geohash is derived locally**, never requested from the API, so it always
 *     matches the encoder the viewport query uses.
 *   - The client is built lazily so importing this module (e.g. in tests) needs
 *     no AWS credentials; it picks up the Lambda's Region (`eu-central-1`,
 *     ADR-0017), keeping geocoding traffic in the EU (data residency, §5.6).
 *
 * A "no match" returns `null` (non-fatal); only a genuine API/infra error
 * throws, which the agent treats as "geocoding unavailable" and proceeds
 * unlocated (§5.4.4).
 */
export function createAmazonLocationGeocoder(config: AmazonLocationGeocoderConfig = {}): Geocoder {
  const client = config.client ?? new GeoPlacesClient({});
  const minMatchScore = config.minMatchScore ?? MIN_MATCH_SCORE;
  const log = config.log ?? (() => {});

  return {
    async geocode(query) {
      const trimmed = query.trim();
      if (!trimmed) return null;

      const output = await client.send(
        new GeocodeCommand({
          QueryText: trimmed,
          MaxResults: 1,
          IntendedUse: GeocodeIntendedUse.STORAGE,
        }),
      );

      const top = output.ResultItems?.[0];
      const position = top?.Position;
      // Position is [longitude, latitude]; anything else is unusable.
      if (!position || position.length < 2) {
        log({ event: 'geocode.miss', matched: false });
        return null;
      }

      const score = top?.MatchScores?.Overall;
      if (typeof score === 'number' && score < minMatchScore) {
        log({ event: 'geocode.lowConfidence', score });
        return null;
      }

      const [lng, lat] = position;
      const geohash = encodeGeohash(lat, lng, GEOHASH_PRECISION);
      log({ event: 'geocode.hit', placeType: top?.PlaceType, score });
      return {
        lat,
        lng,
        geohash,
        geohashPrefix: geohashPrefix(geohash),
      };
    },
  };
}
