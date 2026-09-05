# ADR-0064: Reserve ReportWork operation names for guarded resolvers

- **Status:** Accepted
- **Date:** 2026-09-05
- **Scope:** CRIS-32/CRIS-33 deployment correction
- **Refines:** ADR-0063

## Context

The `ReportWork` model generates `getReportWork` and `updateReportWork`, colliding
with the custom operations introduced in ADR-0063. Type checking passes, but the
GraphQL transformer rejects the duplicate field during backend assembly.
Read-only model authorization does not disable operation generation.

## Decision

Disable the model's generated `get` and all generated mutations using
`disableOperations(['get', 'mutations'])`. Keep the custom operation names and
their guarded Lambda handlers. Generated list access retains the existing
coordinator/admin read authorization. The table and its identity are unchanged.

Renaming custom operations would require coordinated frontend and handler
changes and leave unnecessary generated writes in the API. Disabling all model
reads would also remove the existing staff list capability.

## Consequences

Single-record reads use the custom redacted view; writes use the version-checked,
audited custom mutation. No frontend operation rename or data migration is needed.
A local regression test runs the real GraphQL construct against the application
schema with fixture auth and Lambda resources, so ordinary CI catches generated
operation collisions before deployment. It requires no AWS credentials and does
not deploy resources.
