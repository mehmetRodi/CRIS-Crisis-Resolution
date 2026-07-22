# ADR-0030: `publishReportUpdate` must declare its own operation-level auth rule

- **Status:** Accepted
- **Date:** 2026-07-22
- **Deciders:** Team (CRIS-19)
- **Supersedes:** [ADR-0029](0029-worker-iam-publish-wiring.md) Decision 1 (the rule-less /
  `allow.resource`-only auth model). ADR-0029 Decisions 2–5 remain in force.

## Context

ADR-0029 Decision 1 declared `publishReportUpdate` **rule-less** — no per-operation `allow`
rule — on the belief that a single schema-level grant,
`allow.resource(classifyReportFn).to(['mutate'])`, would supply the operation's authorization
and thereby close "the last client-facing door on the real-time channel." Its own **"Validation
owed on deploy"** caveat recorded that this had never been exercised against live AWS.

The first `ampx pipeline-deploy` on `main` discharged that caveat by failing:

```
[InvalidSchemaError] Custom operation publishReportUpdate requires both an
authorization rule and a handler reference
```

### Why the rule-less design cannot deploy

Tracing the Amplify data-schema processor (`@aws-amplify/data-schema` 1.26.0,
`SchemaProcessor.mjs`) shows the two authorization inputs are **not interchangeable**:

1. `extractFunctionSchemaAccess(schema.data.authorization)` walks the **schema-level** rules
   and siphons every `allow.resource(...)` rule out into a separate `functionSchemaAccess`
   list (it becomes IAM function-access wiring — the `appsync:GraphQL` policy + injected env
   vars on the worker's role). What remains in `schemaAuth` is the **non-resource** rules —
   here, none. So `schemaAuth === []`.
2. For each operation, `mostRelevantAuthRules = operation.authorization ?? schemaAuth`. With no
   operation rule and an empty `schemaAuth`, `publishReportUpdate`'s effective auth rules are
   `[]`.
3. `validateCustomOperations` then throws when an operation has a handler but **zero** auth
   rules (or vice versa), because that combination "causes the CFN stack to reach an
   unrecoverable state."

In short: `allow.resource` grants the **function** access to the API, but it is **never**
counted as the **operation's** authorization. Amplify Gen 2 has no operation-level
`allow.resource`, and no way to express "only this Lambda's IAM role, no Cognito principal" as
an operation rule. A Lambda-backed custom operation must therefore always carry at least one
per-operation `allow` rule. ADR-0029 Decision 1 was not deployable as written.

## Decision

**Reinstate an operation-level authorization rule on `publishReportUpdate`, and keep the
schema-level `allow.resource` grant for the worker's IAM access.**

```ts
publishReportUpdate: a
  .mutation()
  .arguments({ /* exactly the public fields */ })
  .returns(a.ref('PublicReport'))
  .handler(a.handler.function(publishReportUpdateFn))
  .authorization((allow) => [allow.groups(['ADMIN'])]),
// …and, unchanged, at schema scope:
// .authorization((allow) => [allow.resource(classifyReportFn).to(['mutate'])]);
```

- `allow.groups(['ADMIN'])` is the **narrowest** operation-level rule Amplify offers for this
  field. Every broader alternative (`allow.authenticated()`, `allow.authenticated('identityPool')`,
  `allow.guest()`) opens the channel to ordinary citizens/responders; a group gate on the most
  trusted internal role does not. This restores the exact pre-CRIS-19 posture for the operation.
- The **worker keeps calling over IAM**, authorized by the retained schema-level
  `allow.resource(classifyReportFn).to(['mutate'])` grant and `authMode: 'iam'` — the ADMIN
  rule and the IAM grant coexist on the field. ADR-0029 Decisions 2–5 (data-client-over-IAM,
  reading `process.env`, best-effort publish, persisting the AI `summary`) are unaffected.

## Tradeoffs & consequences

- **Accept — a narrow client-facing door reopens.** ADMIN-group users can technically invoke
  `publishReportUpdate` from a client. This is the door ADR-0029 aimed to close, but closing it
  entirely is not expressible in Amplify Gen 2 for a Lambda-backed operation. Blast radius is
  bounded: ADMIN is the most trusted internal role, the argument list is exactly the public
  fields (so no PII can traverse the channel regardless of caller — the redaction guarantee
  from ADR-0009/0029 is structural, not caller-dependent), and no subscriber consumes the
  mutation until CRIS-28. Revisit if a future Amplify release adds a field-scoped function
  grant or an operation-level IAM-only rule.
- **Gain — the backend deploys.** `ampx pipeline-deploy` synthesizes and the write→publish loop
  is wired end-to-end, so CRIS-28 still only has to switch subscriptions on.
- **No `backend.ts` change.** The `allow.resource` grant and its role wiring are untouched; this
  is purely the addition of one operation-level rule.
- **Lesson recorded for future custom operations.** Any Lambda-backed `a.query()`/`a.mutation()`
  needs its own `.authorization(...)`; a schema-level `allow.resource` grant authorizes the
  calling function but does **not** satisfy the per-operation auth requirement. Pair the two,
  never rely on the resource grant alone.

## Verification

- `npm run typecheck` passes.
- Backend synth (`ampx pipeline-deploy`) proceeds past the schema-validation stage that
  previously threw `InvalidSchemaError` on `publishReportUpdate`.
