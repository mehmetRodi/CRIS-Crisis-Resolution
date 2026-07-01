import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';

/**
 * CrisisMap AI backend (Amplify Gen 2).
 *
 * SCAFFOLD STATUS: this wires the managed auth/data/storage resources only.
 * The custom asynchronous pipeline from the design doc (§3, §5.4) — DynamoDB
 * Streams → SQS → Lambda classification workers → Bedrock → SNS alerts — is NOT
 * defined here yet. It will be added via CDK escape hatches on `backend` (e.g.
 * `backend.createStack(...)` / `backend.data.resources.tables`) under CRIS-10.
 *
 * Nothing here is deployed by the scaffold. Run `npx ampx sandbox` from
 * `apps/web` (with AWS credentials configured) to stand up a personal dev
 * environment. See docs/architecture.md and ADR 0003.
 */
defineBackend({
  auth,
  data,
  storage,
});
