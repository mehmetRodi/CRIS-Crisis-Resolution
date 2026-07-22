# ADR-0027: Amazon Location Places geocoding with shared geohash encoding

- **Status:** Accepted
- **Date:** 2026-07-22
- **Deciders:** Team (CRIS-21)
- **Refines:** ADR-0013 (async classification pipeline), ADR-0026 (Bedrock Triage Agent)

## Context

The Triage Agent can identify a place description, but model-produced coordinates are not a
safe source for map placement. The backend needs an authoritative geocoder and must derive the
`Report.geohash` and `Report.geohashPrefix` fields used by the DynamoDB viewport index.

The resolved coordinate is persisted in DynamoDB, so the Amazon Location request must declare
storage rather than temporary display use. Geocoding is optional to classification: an empty,
weak, or unavailable result must leave the report unlocated instead of failing triage.

## Options considered

1. **Amazon Location Places `Geocode` API with local geohash encoding.** Keeps the existing AWS
   region/IAM model and makes the stored index keys deterministic in shared code.
2. **Have Bedrock return coordinates.** Simpler orchestration, but coordinates could be
   hallucinated and would not provide an authoritative location result.
3. **Use an external geocoding provider.** Viable, but adds another credential, privacy,
   availability, and billing boundary.
4. **Ask the geocoder to provide indexing metadata.** Couples DynamoDB access patterns to a
   provider-specific response and risks inconsistent prefix generation.

## Decision

Use the Amazon Location Places `Geocode` API through `@aws-sdk/client-geo-places`:

- Send one trimmed place query with `IntendedUse: Storage` and `MaxResults: 1`.
- Treat `Position` as GeoJSON order `[longitude, latitude]`.
- Reject an available overall match score below `0.5`; accept results that omit the score.
- Derive a precision-7 geohash and precision-5 prefix locally through
  `@crisismap/shared`, so writers and future viewport readers share one encoder.
- Return `null` for empty, missing, or weak matches. Propagate service errors to the agent,
  which degrades by continuing without a location.
- Keep a null-geocoder implementation behind `GEOCODING_ENABLED` so deployments can disable
  Places safely.

The worker now selects the geocoder from `GEOCODING_ENABLED` (default `'true'`), its role is
granted `geo-places:Geocode` (`backend.ts`), and `@aws-sdk/client-geo-places` is a dependency.
The flag is a kill switch: setting it to `'false'` drops back to null-geocoder mode — reports
are still classified and never lost (§5.4.4) — without a code change if Places degrades.

## Consequences

- **Gain:** stored coordinates come from an authoritative tool result, never model prose.
- **Gain:** a single shared geohash implementation controls both write and viewport-query keys.
- **Gain:** geocoding outages and ambiguous matches do not block classification.
- **Cost:** the worker needs an additional AWS SDK client, Places IAM permission, and request
  cost/quotas.
- **Cost:** the `0.5` threshold is an operational default that should be tuned using real
  incident-location data.
- **Constraint:** map tiles are a separate integration; this decision covers backend Places
  geocoding only.
