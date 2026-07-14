import { defineFunction } from '@aws-amplify/backend';

/**
 * `classify-report` — the async AI-triage worker (design doc §3, §5.4; CRIS-10).
 *
 * Consumes the classification SQS queue (fed by the Report DynamoDB stream via
 * an EventBridge Pipe — wired in `backend.ts`), claims the report
 * (NEW → PROCESSING via an optimistic-lock conditional write), calls Bedrock
 * under the JSON-only contract (`@crisismap/shared` classification schema),
 * scores deterministically (§5.4.2), writes the result back conditionally, and —
 * once CRIS-19 lands — calls the IAM-only `publishReportUpdate` mutation so
 * subscribers update in near real time. A Bedrock/parse failure leaves the
 * report as NEEDS_VERIFICATION, never lost (§5.4.4).
 *
 * The SQS event-source mapping and least-privilege IAM (Bedrock, SQS, and direct
 * DynamoDB writes granted via `grantReadWriteData`/`grantWriteData`) are attached
 * in `backend.ts` — `defineFunction` has no SQS-trigger prop, so the mapping is
 * added with CDK.
 *
 * timeout: 60 s gives headroom over the §3.2 p95 < 15 s classification target
 * for the one Bedrock repair attempt + (future) geocode call.
 */
export const classifyReport = defineFunction({
  name: 'classify-report',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 60,
  memoryMB: 1024,
  environment: {
    // Bedrock model id. Current Claude tiers are invoked via an EU cross-Region
    // *inference profile* (`eu.` prefix) so triage traffic stays inside the EU
    // geography (data residency, §5.6; ADR-0017). Haiku is the default: triage
    // is short-text → structured-JSON extraction, a Haiku-class job, and the
    // cheapest/fastest tier best fits the 1,000 writes/min + p95 < 15 s targets
    // (§3.2). Swap to `eu.anthropic.claude-sonnet-5` for more reasoning headroom
    // with no IAM change (the grant is a `claude-*` family wildcard). NO
    // secrets/PII in env.
    BEDROCK_MODEL_ID: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0',
    // Feature flag for the CRIS-13 Amazon Location geocoder. Off until the place
    // index exists; the worker leaves location unresolved meanwhile.
    GEOCODING_ENABLED: 'false',
  },
});
