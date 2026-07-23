# ADR-0031: Pin the classify-report worker to the `data` nested stack

- **Status:** Accepted
- **Date:** 2026-07-23
- **Deciders:** Team (CRIS-19)
- **Relates-to:** [ADR-0029](0029-worker-iam-publish-wiring.md) (worker as IAM publisher),
  [ADR-0030](0030-publish-mutation-requires-operation-auth-rule.md) (operation auth rule),
  [ADR-0013](0013-async-classification-pipeline.md) (async classification pipeline)

## Context

With `publishReportUpdate` deployable again (ADR-0030), `ampx pipeline-deploy` proceeded past
schema synthesis and then failed at CloudFormation assembly:

```
[CloudformationStackCircularDependencyError] The CloudFormation deployment failed due to
circular dependency found between nested stacks [data…, function…]
```

Amplify Gen 2 provisions resources into a handful of managed **nested stacks** (`auth`, `data`,
`function`, `storage`, …). CloudFormation forbids two nested stacks from referencing each other.
Between `data` and `function` there were, after CRIS-19, two **opposing** edges:

- **`function → data`** — the EventBridge Pipe wired in `backend.ts` reads the **Report** table's
  DynamoDB stream ARN. The pipe and the `classify-report` worker it feeds lived in the default
  `function` stack, so that stack referenced a `data`-stack resource. This edge existed before
  CRIS-19 and was harmless on its own (one-directional).
- **`data → function`** — CRIS-19's schema-level `allow.resource(classifyReport).to(['mutate'])`
  makes the **data** construct attach an `appsync:GraphQL` policy to the worker's IAM role (and
  inject the API endpoint/introspection env vars). Because the worker's role lived in the
  `function` stack, the `data` stack now referenced a `function`-stack resource.

Two edges in opposite directions between the same pair of stacks = the cycle CFN rejected.

> **Correction to ADR-0029.** ADR-0029's "No new `backend.ts` wiring" bullet claimed *"All edges
> are `classify-report → data` … so no cross-stack cycle is introduced."* That is wrong:
> `allow.resource` introduces a `data → function` edge, which is precisely the opposing edge that
> closes the cycle. The claim was never exercised against AWS (ADR-0029's "validation owed on
> deploy" caveat). This ADR records the actual topology and the fix.

## Decision

**Provision the `classify-report` worker inside the `data` nested stack** by declaring
`resourceGroupName: 'data'` on its `defineFunction`:

```ts
export const classifyReport = defineFunction({
  name: 'classify-report',
  entry: './handler.ts',
  // …
  resourceGroupName: 'data',
});
```

This is Amplify's [documented resolution](https://docs.amplify.aws/react/build-a-backend/troubleshooting/circular-dependency/)
for a function that calls the data API: co-locate it with the data resources so the grant is
intra-stack. Consequences for the existing `backend.ts` escape-hatch wiring:

- The worker's IAM role, the `allow.resource` `appsync:GraphQL` grant, and the injected endpoint
  env vars are now all **inside** the `data` stack — the `data → function` edge disappears (it is
  intra-`data`).
- `const pipelineStack = Stack.of(worker)` now resolves to the **`data`** stack, so the queues,
  DLQ, EventBridge Pipe, pipe role, and the observability alarms/dashboard/SNS topic — all created
  in `pipelineStack` — are provisioned in the `data` stack too. The pipe's read of the Report
  stream ARN becomes intra-stack, erasing the `function → data` edge.
- The `data`-handler resolvers (`submitReport`, `updateReportStatus`, `publishReportUpdate`) are
  already placed in the `data` stack by Amplify, so the observability wiring that references them
  from `pipelineStack` stays intra-stack.

No application code, IAM scoping, event filtering, or runtime behavior changes — this is purely a
stack-placement decision. The default `function` stack simply no longer holds these resources.

## Alternatives considered

- **Grant `appsync:GraphQL` to the worker manually in `backend.ts` instead of `allow.resource`.**
  A manual grant is a `function → data` edge only, so it would also break the cycle without moving
  stacks. Rejected: it drops the automatic endpoint/introspection env-var injection that
  `allow.resource` provides, forcing us to reinvent exactly the wiring ADR-0029 Decision 2 chose
  `allow.resource` to avoid. `resourceGroupName` keeps ADR-0029 Decisions 2–5 intact.
- **Move only the pipe/queues to the data stack, leave the worker in `function`.** Doesn't help:
  the `allow.resource` `data → function` edge to the worker's role remains, and the worker's SQS
  event source would then cross stacks. The worker itself is the resource both edges pivot on, so
  it is the thing that must move.

## Tradeoffs & consequences

- **Gain:** the backend deploys; every classify-pipeline edge is intra-`data`-stack; ADR-0029's
  data-client-over-IAM design is preserved unchanged.
- **Accept — a fuller data stack.** The `data` stack now also owns the worker, its SQS
  queues/DLQ/pipe, and the ops alarms/dashboard/SNS topic. This is the standard Amplify shape for
  data-adjacent async resources and keeps all `classify → data` references local. The default
  `function` stack becomes correspondingly lighter.
- **Deploy-time note (ADR-0013 still applies).** Enabling the Report stream changes the table's
  custom-resource update path; deploy on a fresh sandbox first.

## Verification

- `npm run typecheck` (amplify project) passes with `resourceGroupName: 'data'` set.
- The `data → function` grant edge and the `function → data` pipe edge are both intra-stack by
  construction once the worker is in the `data` group; the specific
  `CloudformationStackCircularDependencyError` between `[data, function]` cannot recur.
- Full confirmation is the next `ampx pipeline-deploy` reaching CloudFormation execution (the
  assembly-time cycle check is what previously failed); this could not be run against live AWS
  in-repo.
