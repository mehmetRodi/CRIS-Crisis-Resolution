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
    // Bedrock model id (Bedrock IDs carry the `anthropic.` prefix). Overridable
    // so the team can trade cost/latency (e.g. a Sonnet/Haiku tier) without a
    // code change — see ADR-0013. NO secrets/PII in env.
    BEDROCK_MODEL_ID: 'anthropic.claude-opus-4-8',
    // Feature flag for the CRIS-13 Amazon Location geocoder. Off until the place
    // index exists; the worker leaves location unresolved meanwhile.
    GEOCODING_ENABLED: 'false',
  },
});
