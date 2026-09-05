# ADR-0065: Type resolver Lambdas against the function-directive payload

- **Status:** Accepted
- **Date:** 2026-09-05
- **Scope:** CRIS-32/CRIS-33 deployment correction
- **Refines:** ADR-0011, ADR-0046, ADR-0063

## Context

`getReportWork`, `listMyReportWork`, and `updateReportWork` share one Lambda, so the
handler branched on `event.info.fieldName` — the operation name as
`AppSyncResolverEvent` from `@types/aws-lambda` describes it. Every deployed call
failed with `Cannot read properties of undefined (reading 'fieldName')`, surfaced
verbatim in the workspace's "Ownership & progress" panel.

Amplify's function directive does not forward the AppSync resolver context. Its
generated request template invokes the function with a hand-built payload:

```
{ typeName, fieldName, arguments, identity, source, request, prev }
```

There is no `info`. `AppSyncResolverEvent` describes a _pipeline resolver's_ context
and is the wrong contract for a direct-Lambda resolver, but it type-checks, because
every other field the handlers read — `arguments`, `identity` — happens to line up.
Nothing caught this: our other resolvers each serve exactly one field and never need
the operation name, and the shared test event builder invented an `info` block, so
the integration tests passed against a payload AppSync never sends.

## Decision

Describe the real payload once, in `apps/web/amplify/functions/appsync-event.ts`:

```ts
type FunctionResolverEvent<TArgs> = Omit<AppSyncResolverEvent<TArgs>, 'info'> & {
  typeName: string;
  fieldName: string;
};
```

`info` is **omitted**, not merely unused, so reaching for it fails to compile instead
of throwing on the first real invocation. Every resolver handler and the shared test
builder (`functions/testing/appsync.ts`) now use this type and its
`FunctionResolverHandler` alias; the multiplexing handler branches on the top-level
`event.fieldName`.

The alternative — reading `event.info?.fieldName ?? event.fieldName` defensively —
was rejected. It keeps both contracts alive in the source and leaves the tests free to
exercise the shape production never sends, which is exactly how this reached deploy.

## Consequences

Ownership reads, claims, assignment, and progress updates work against a deployed
backend. The handler tests now run against the payload AppSync actually delivers, and
one names the contract explicitly. Any future multi-field resolver gets the operation
name from the same typed field, and a handler that reaches for `info` no longer
type-checks.

The type is hand-maintained against Amplify's generated template; an Amplify upgrade
that changes the invocation payload would not be caught by type checking. The handler
tests would still fail, since they build the payload from this same definition — the
detection is behavioural, not structural.
