/**
 * Post-deploy synthetic smoke transaction (CRIS-35, ADR-0051).
 *
 * Proves the deployed environment works end to end — the one thing neither CI
 * (no AWS, ADR-0012) nor the sandbox-only live suite (ADR-0046) can: a guest
 * report submitted through the real API is picked up by the async pipeline
 * (Streams → Pipe → SQS → Lambda → Bedrock → scoring → write-back) and produces
 * structured classification fields. A valid low-confidence classification may
 * land in NEEDS_VERIFICATION; the gate fails only when that status has no AI
 * fields, which is how the worker records handled Bedrock/contract failures.
 *
 * Footprint per run: ONE report (marked "[CRIS-35 SMOKE]", driven to REJECTED
 * or deleted in cleanup) and ONE throwaway coordinator user (deleted in
 * cleanup). The gate verifies the deploy; it never undoes it — rollback is the
 * manual procedure in docs/runbooks/incident-response.md.
 */
import { randomUUID } from 'node:crypto';
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession, signIn, signOut } from 'aws-amplify/auth';
import { generateClient } from 'aws-amplify/data';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReportStatus, UserRole } from '@crisismap/shared';
import type { Schema } from '../../amplify/data/resource';
import outputs from '../../amplify_outputs.json';
import { hasStructuredClassification } from './classification-outcome';

const REQUIRED_TARGET = 'deployed';
const RUN_ID = randomUUID();
const PASSWORD = `Crisismap!35-${RUN_ID}`;
const SMOKE_MARKER = '[CRIS-35 SMOKE]';
/** §3.2 classification target is p95 < 15 s; the budget adds cold-start headroom. */
const CLASSIFICATION_BUDGET_MS = 180_000;
const POLL_INTERVAL_MS = 3_000;

interface DeployedOutputs {
  auth?: {
    aws_region?: string;
    user_pool_id?: string;
  };
  data?: {
    url?: string;
    aws_region?: string;
  };
}

interface GraphQLError {
  message: string;
  errorType?: string;
}

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: GraphQLError[];
}

interface SmokeReport {
  id: string;
  status: string;
  version: number;
  category?: string | null;
  urgency?: string | null;
  confidence?: number | null;
  priorityScore?: number | null;
  priorityBand?: string | null;
  summary?: string | null;
}

const config = outputs as DeployedOutputs;
let cognito: CognitoIdentityProviderClient;
let userPoolId: string;
let endpoint: string;
let coordinatorUsername: string | undefined;
let coordinatorToken: string;
let smokeReportId: string | undefined;

function assertDeployedTarget(): void {
  if (process.env.CRISISMAP_SMOKE_TARGET !== REQUIRED_TARGET) {
    throw new Error(
      `Refusing to run the smoke transaction. Set CRISISMAP_SMOKE_TARGET=${REQUIRED_TARGET} ` +
        'only when amplify_outputs.json points at the environment you mean to verify ' +
        '(deploy.yml does this after pipeline-deploy; see docs/runbooks/incident-response.md).',
    );
  }
  if (!config.auth?.aws_region || !config.auth.user_pool_id) {
    throw new Error('amplify_outputs.json has no deployed Auth configuration.');
  }
  if (!config.data?.url || !config.data.aws_region) {
    throw new Error('amplify_outputs.json has no deployed Data configuration.');
  }
}

async function graphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<GraphQLResponse<T>> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: token, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(`AppSync HTTP ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as GraphQLResponse<T>;
}

function requireData<T>(response: GraphQLResponse<T>): T {
  if (response.errors?.length || !response.data) {
    throw new Error(`Unexpected GraphQL response: ${JSON.stringify(response.errors ?? response)}`);
  }
  return response.data;
}

/** One throwaway coordinator to observe classification and reject the report. */
async function createCoordinator(): Promise<string> {
  const username = `cris35-smoke-${RUN_ID}@example.com`;
  await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: username,
      MessageAction: 'SUPPRESS',
      TemporaryPassword: PASSWORD,
      UserAttributes: [
        { Name: 'email', Value: username },
        { Name: 'email_verified', Value: 'true' },
      ],
    }),
  );
  coordinatorUsername = username;
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: username,
      Password: PASSWORD,
      Permanent: true,
    }),
  );
  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId,
      Username: username,
      GroupName: UserRole.COORDINATOR,
    }),
  );

  await signOut().catch(() => undefined);
  const signInResult = await signIn({ username, password: PASSWORD });
  if (!signInResult.isSignedIn) {
    throw new Error(
      `Smoke coordinator did not complete sign-in (${signInResult.nextStep.signInStep}).`,
    );
  }
  const session = await fetchAuthSession({ forceRefresh: true });
  const token = session.tokens?.idToken?.toString();
  await signOut();
  if (!token) throw new Error('Cognito returned no ID token for the smoke coordinator.');
  return token;
}

async function getReport(reportId: string): Promise<SmokeReport | undefined> {
  const data = requireData(
    await graphql<{ getReport: SmokeReport | null }>(
      coordinatorToken,
      `
        query GetReport($id: ID!) {
          getReport(id: $id) {
            id
            status
            version
            category
            urgency
            confidence
            priorityScore
            priorityBand
            summary
          }
        }
      `,
      { id: reportId },
    ),
  );
  return data.getReport ?? undefined;
}

async function pollUntilClassified(reportId: string): Promise<SmokeReport | undefined> {
  const deadline = Date.now() + CLASSIFICATION_BUDGET_MS;
  let report: SmokeReport | undefined;
  for (;;) {
    report = await getReport(reportId);
    const status = report?.status;
    if (status && status !== ReportStatus.NEW && status !== ReportStatus.PROCESSING) return report;
    if (Date.now() >= deadline) return report;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

describe('post-deploy smoke transaction', () => {
  beforeAll(async () => {
    assertDeployedTarget();
    Amplify.configure(outputs);
    userPoolId = config.auth!.user_pool_id!;
    endpoint = config.data!.url!;
    cognito = new CognitoIdentityProviderClient({ region: config.auth!.aws_region! });
    coordinatorToken = await createCoordinator();
  });

  afterAll(async () => {
    // Best-effort cleanup: reject the synthetic report through the guarded
    // mutation (legal from both classification outcomes); if it never left
    // NEW/PROCESSING, delete it outright so it cannot linger in the queue.
    if (smokeReportId && coordinatorToken) {
      const report = await getReport(smokeReportId).catch(() => undefined);
      const rejectable =
        report?.status === ReportStatus.AI_CLASSIFIED ||
        report?.status === ReportStatus.NEEDS_VERIFICATION;
      if (report && rejectable) {
        await graphql(
          coordinatorToken,
          `
            mutation RejectSmokeReport($reportId: ID!, $toStatus: String!, $expectedVersion: Int!) {
              updateReportStatus(
                reportId: $reportId
                toStatus: $toStatus
                expectedVersion: $expectedVersion
              ) {
                id
                status
                version
              }
            }
          `,
          {
            reportId: smokeReportId,
            toStatus: ReportStatus.REJECTED,
            expectedVersion: report.version,
          },
        ).catch(() => undefined);
      } else if (report) {
        await graphql(
          coordinatorToken,
          'mutation DeleteReport($input: DeleteReportInput!) { deleteReport(input: $input) { id } }',
          { input: { id: smokeReportId } },
        ).catch(() => undefined);
      }
    }
    await signOut().catch(() => undefined);
    if (cognito && userPoolId && coordinatorUsername) {
      await cognito
        .send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: coordinatorUsername }))
        .catch(() => undefined);
    }
    cognito?.destroy();
  });

  it('classifies a synthetic guest report end to end and rejects it afterwards', async () => {
    await signOut().catch(() => undefined);
    const reportingClient = generateClient<Schema>({ authMode: 'identityPool' });

    const submittedAt = Date.now();
    const submission = await reportingClient.mutations.submitReport({
      text: `${SMOKE_MARKER} Synthetic post-deploy verification report ${RUN_ID}. Safe to reject.`,
      clientRequestId: `cris35-smoke-${RUN_ID}`,
      isAnonymous: true,
    });
    const submitAckMs = Date.now() - submittedAt;
    if (submission.errors?.length || !submission.data) {
      throw new Error(
        `Guest smoke submission failed: ${JSON.stringify(submission.errors ?? submission)}`,
      );
    }
    smokeReportId = submission.data.id;
    expect(submission.data.status).toBe(ReportStatus.NEW);

    const classified = await pollUntilClassified(smokeReportId);
    const classifiedMs = Date.now() - submittedAt;
    // The §3.2 targets are p95 targets; a single cold-start sample is not a
    // measurement of them, so the latency is reported, not asserted (only the
    // hard CLASSIFICATION_BUDGET_MS bound fails the gate).
    console.log(
      JSON.stringify({
        event: 'smoke.measured',
        reportId: smokeReportId,
        submitAckMs,
        classifiedMs,
        status: classified?.status ?? 'unknown',
      }),
    );

    if (!classified || classified.status === ReportStatus.NEW) {
      throw new Error(
        `Report ${smokeReportId} was never picked up by the pipeline within ` +
          `${CLASSIFICATION_BUDGET_MS / 1000}s — check the Stream→SQS pipe and its DLQ.`,
      );
    }
    if (classified.status === ReportStatus.PROCESSING) {
      throw new Error(
        `Report ${smokeReportId} is stuck in PROCESSING after ` +
          `${CLASSIFICATION_BUDGET_MS / 1000}s — check classify-report logs and the queue DLQ.`,
      );
    }
    if (classified.status === ReportStatus.NEEDS_VERIFICATION) {
      // NEEDS_VERIFICATION is also a valid model outcome for an intentionally
      // synthetic/low-confidence report. A handled Bedrock or contract failure
      // takes the same status path but leaves every classification field unset.
      if (!hasStructuredClassification(classified)) {
        throw new Error(
          `Report ${smokeReportId} landed in NEEDS_VERIFICATION without structured AI fields: ` +
            'Bedrock triage is degraded (model access, quota, or contract parsing). No alarm ' +
            'covers this case — see docs/runbooks/incident-response.md.',
        );
      }
      return;
    }
    expect(classified.status).toBe(ReportStatus.AI_CLASSIFIED);
    expect(classified.priorityScore).toEqual(expect.any(Number));
    expect(classified.priorityBand).toEqual(expect.any(String));
  });
});
