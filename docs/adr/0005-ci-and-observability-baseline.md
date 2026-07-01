# ADR-0005: CI + observability baseline

- **Status:** Accepted
- **Date:** 2026-07-01
- **Deciders:** Team (scaffolding)

## Context

CRIS-15 asks for a "CI and observability baseline." At scaffold time there are no deployed
resources and no Lambdas, so runtime observability (CloudWatch metrics/alarms, X-Ray traces)
has nothing to instrument yet. We still want quality gates from day one and a clear contract
for observability so it isn't bolted on later.

## Options considered

- **CI now, observability as conventions + docs** — GitHub Actions runs format/lint/typecheck/
  build/test on every PR; observability is captured as logging/tracing conventions
  (docs/conventions.md) and wired when the pipeline lands. Pragmatic; defers only what can't
  exist yet.
- **Stand up observability infra now** — provision CloudWatch dashboards/alarms and X-Ray
  ahead of the code they observe. Premature; nothing emits signals yet and it couples the
  scaffold to a deployed environment.

## Decision

Ship a **GitHub Actions CI pipeline now** (`.github/workflows/ci.yml`: format → lint →
typecheck → build → test on the `.nvmrc` Node version, no AWS credentials, no deploy).
Capture **observability as conventions** (structured JSON logs with correlation/`reportId`,
no PII; planned X-Ray tracing; planned latency/DLQ metrics) in `docs/conventions.md`, to be
wired with the Lambda pipeline (CRIS-10/14).

## Tradeoffs & consequences

- **Gain:** quality gates and fast feedback from the first PR; a documented observability
  contract so instrumentation is designed in, not retrofitted.
- **Give up:** no live dashboards/alarms yet — acceptable because there is nothing to observe.
- **Commits us to:** adding a deploy job (`ampx pipeline-deploy`) and the CloudWatch/X-Ray
  wiring when the backend becomes real (CRIS-14), and to honoring the no-PII-in-logs rule in
  every worker.
