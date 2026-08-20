# ADR-0051: Correct smoke classification and resolver-alarm semantics

- **Status:** Accepted
- **Date:** 2026-08-20
- **Deciders:** Team (CRIS-35 review)
- **Refines:** ADR-0050 (post-deploy smoke gate and alarm completion)

## Context

Review of ADR-0050's implementation found three correctness gaps:

1. The smoke transaction used Cognito admin APIs, but the GitHub OIDC role had no direct
   Cognito permission, so verification would fail before reaching AppSync.
2. `NEEDS_VERIFICATION` represents both a handled Bedrock/contract failure and a valid
   low-confidence or human-review classification. Status alone cannot distinguish them.
3. Lambda's `Errors` metric counts expected resolver validation and domain rejections. With a
   threshold of one, an anonymous invalid media request or normal optimistic-lock conflict could
   page operations even though the service was healthy.

## Decision

1. Grant the OIDC deploy role only the four Cognito admin actions required to create, configure,
   group, and delete the throwaway smoke coordinator, scoped to user pools in the deployment
   account and region. CDK provisioning remains behind the bootstrap roles.
2. Accept either `AI_CLASSIFIED` or a structured `NEEDS_VERIFICATION` result. A
   `NEEDS_VERIFICATION` result fails the gate only when classification fields are absent, which is
   the worker's handled Bedrock/contract-failure path.
3. Guarded/public resolvers emit a PII-free CloudWatch Embedded Metric Format
   `UnexpectedErrors` metric at their outer handler boundary. Stable validation, authorization,
   legality, and conflict errors still propagate unchanged but emit no metric. Their alarms use
   this metric; handlers without expected client/domain failures retain Lambda `Errors` alarms.

## Consequences

- The deploy role gains narrow direct authority over users in deployment-region Cognito pools;
  it cannot create pools or change pool configuration. Existing accounts must redeploy the
  bootstrap role stack before their first CRIS-35 smoke-gated deploy.
- A valid cautious model answer no longer makes a healthy deploy red, while unavailable or
  contract-invalid AI still fails verification.
- Resolver API behavior and error messages do not change. Future unexpected failures inside the
  instrumented handler boundary page automatically; any new expected error code must be added to
  the handler's explicit allow-list.
