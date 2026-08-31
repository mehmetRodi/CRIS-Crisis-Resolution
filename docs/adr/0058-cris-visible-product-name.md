# ADR-0058: CRIS as the visible product name

- **Status:** Accepted
- **Date:** 2026-08-31
- **Deciders:** Product owner + implementation

## Context

The product was presented as “CrisisMap AI” or “CrisisMap” across the web and mobile
wordmarks, accessibility labels, installed-app metadata, alerts, and operational displays.
The product owner selected the shorter name “CRIS” for every human-facing surface.

The repository also contains established identifiers using `crisismap`, including npm package
scopes, application and bundle identifiers, local-storage keys, environment variables, AWS
resource names, metric namespaces, IAM identities, and the repository name. Those values are
integration contracts rather than display copy. Renaming them would require coordinated data,
deployment, device-installation, and developer-environment migrations without changing what a
person sees.

## Decision

1. The visible product name is **CRIS**. Web and mobile wordmarks, accessible names, browser and
   installed-app metadata, permission explanations, citizen alert copy, package descriptions,
   living documentation, and operator-facing labels use that name.
2. Compatibility-sensitive identifiers keep their existing values. In particular, this decision
   does not rename `@crisismap/*`, `crisismap.*` storage keys, `CRISISMAP_*` environment variables,
   native bundle/package identifiers, backing AWS logical or physical resource identifiers, IAM
   group and permission-set names, metric namespaces, or the repository. Display-oriented AWS
   properties such as the CloudWatch dashboard name, topic display name, and resource descriptions
   are human-facing labels and do change to CRIS.
3. Accepted ADRs remain unchanged as historical records. This ADR records the naming change
   instead of rewriting the terminology used when earlier decisions were accepted.

## Consequences

- People encounter one concise name across the citizen, responder, coordinator, volunteer, and
  operator experiences.
- Screen-reader output and notification copy match the visual wordmark.
- Internal identifiers can still contain the former name. This is deliberate and is not branding
  drift; future work must treat changing any such identifier as a migration with its own decision.
