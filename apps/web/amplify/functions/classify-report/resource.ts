import { defineFunction } from '@aws-amplify/backend';

/**
 * `classify-report` — the async AI-triage worker (design doc §3, §5.4; CRIS-10).
 *
 * Consumes the classification SQS queue (fed by the Report DynamoDB stream via
 * an EventBridge Pipe — wired in `backend.ts`), claims the report
 * (NEW → PROCESSING via an optimistic-lock conditional write), runs the Bedrock
 * **Triage Agent** (§5.5, CRIS-20, ADR-0026) — a tool-using agent that emits the
 * JSON-only contract (`@crisismap/shared` triage schema) and calls a geocoding
 * tool when coordinates are missing, degrading to the MVP single-call classifier
 * if agent orchestration is unavailable — scores deterministically (§5.4.2),
 * writes the result back conditionally, and calls `publishReportUpdate` over its
 * IAM grant. Custom subscriptions that consume that mutation remain deferred. A
 * triage/parse failure leaves the report as NEEDS_VERIFICATION, never
 * lost (§5.4.4).
 *
 * The SQS event-source mapping and least-privilege IAM (Bedrock, SQS, and direct
 * DynamoDB writes granted via `grantReadWriteData`/`grantWriteData`) are attached
 * in `backend.ts` — `defineFunction` has no SQS-trigger prop, so the mapping is
 * added with CDK.
 *
 * timeout: 60 s gives headroom over the §3.2 p95 < 15 s classification target
 * for the agent's multi-turn tool loop (geocode + submit + one repair).
 */
export const classifyReport = defineFunction({
  name: 'classify-report',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 60,
  memoryMB: 1024,
  // Provision this worker INSIDE the `data` nested stack (ADR-0031). It calls the
  // data API — the schema's `allow.resource(classifyReport)` grant (CRIS-19)
  // makes the data stack attach an `appsync:GraphQL` policy to this function's
  // role (data → function), while the Report-stream pipe wired in `backend.ts`
  // reads the data table's stream (function → data). Left in the default
  // `function` stack those opposing edges form a nested-stack cycle CloudFormation
  // rejects (CloudformationStackCircularDependencyError). Co-locating the worker
  // with the data resources it both reads from and writes to makes every edge
  // intra-stack. This is Amplify's documented fix for a function that calls the
  // data API. https://docs.amplify.aws/react/build-a-backend/troubleshooting/circular-dependency/
  resourceGroupName: 'data',
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
    // Feature flag for the Amazon Location geocoder behind the Triage Agent's
    // geocode_location tool (CRIS-21, ADR-0027). On → the worker resolves
    // described locations via the Amazon Location Places `Geocode` API and
    // derives the geohash locally; off → every lookup returns "unavailable" and
    // reports stay unlocated (the tool-use path still runs). A kill switch: flip
    // to 'false' to shed the geocoding dependency without a code change if the
    // Places API degrades — reports are still classified and never lost (§5.4.4).
    GEOCODING_ENABLED: 'true',
  },
});
