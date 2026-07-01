# ADR-0003: Backend / IaC — Amplify Gen 2 with CDK escape hatches

- **Status:** Accepted
- **Date:** 2026-07-01
- **Deciders:** Team (scaffolding)

## Context

We need Infrastructure as Code for Cognito (auth + groups + anonymous), AppSync GraphQL with
subscriptions, DynamoDB, and S3, **plus** a custom asynchronous pipeline (DynamoDB Streams →
SQS → Lambda → Bedrock → SNS) from the design doc (§3, §5.4). The design doc lists "AWS CDK or
Terraform" and repeatedly leans on Amplify ("Amplify handles build, deploy, auth wiring"). The
team is new to AWS, so the on-ramp matters, but we must not be boxed out of the custom pipeline.

## Options considered

- **Amplify Gen 2 (+ CDK escape hatch)** — TypeScript `defineAuth/defineData/defineStorage`
  wires Cognito + AppSync + DynamoDB + S3 and generates typed client code; a local sandbox
  speeds iteration; drop to raw CDK on the `backend` object for custom resources. Higher-level
  abstraction can occasionally hide details.
- **Pure AWS CDK (TypeScript)** — full control, one language, but you hand-wire auth/data/
  real-time subscriptions with much more boilerplate. Steeper for newcomers.
- **Terraform** — industry standard, strong state management, but adds a second language (HCL)
  to an otherwise all-TypeScript codebase and is verbose for AppSync/GraphQL.
- **AWS SAM** — light and Lambda-focused, but weak for the frontend + Cognito + AppSync
  integration we need.

## Decision

Use **AWS Amplify Gen 2** for auth/data/storage/hosting, and **CDK escape hatches** (via the
`backend` object) for the custom Streams→SQS→Lambda→Bedrock→SNS pipeline. All TypeScript.

## Tradeoffs & consequences

- **Gain:** gentlest on-ramp for a team new to AWS; Amplify removes the most painful auth+API+
  data wiring, provides a personal `ampx sandbox`, and generates typed GraphQL client code; it
  matches the design doc's stated direction. We keep full CDK power where we need it.
- **Give up:** some transparency — Amplify decides parts of the CloudFormation for us. When we
  need control we use the escape hatch, accepting a mixed Amplify+CDK mental model.
- **Commits us to:** Node 20/22 (Amplify Gen 2 runtime), the `ampx` CLI, and keeping the
  Amplify `data` enum literals in sync with `@crisismap/shared`. The async pipeline (CRIS-10)
  will be authored as CDK constructs attached to the Amplify backend, **not** as Amplify
  primitives. `amplify_outputs.json` and `.amplify/` are generated and git-ignored.
