/**
 * Live API contract tests for a disposable personal sandbox (CRIS-29, ADR-0046).
 *
 * These tests create Cognito users, DynamoDB-backed model rows, append-only audit/
 * idempotency records, and one S3 object. They must never point at a shared stage.
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
import { parseMediaUploadFields, ReportStatus, UserRole } from '@crisismap/shared';
import type { Schema } from '../../amplify/data/resource';
import outputs from '../../amplify_outputs.json';

const REQUIRED_TARGET = 'personal-sandbox';
const RUN_ID = randomUUID();
const PASSWORD = `Crisismap!29-${RUN_ID}`;

interface SandboxOutputs {
  auth?: {
    aws_region?: string;
    user_pool_id?: string;
    user_pool_client_id?: string;
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

interface ReportResult {
  id: string;
  text: string;
  status: string;
  version: number;
  reporterId?: string | null;
  reporterContact?: string | null;
  mediaKeys?: Array<string | null> | null;
  createdAt?: string | null;
  updatedAt: string;
}

interface VolunteerTaskResult {
  reportId: string;
  status: string;
  summary?: string | null;
  teamId?: string | null;
  teamName?: string | null;
  column: string;
}

const config = outputs as SandboxOutputs;
const createdUsers: string[] = [];
const cleanupMutations: Array<{ query: string; variables: Record<string, unknown> }> = [];
const tokens = new Map<UserRole, string>();
const usernames = new Map<UserRole, string>();
const submittedReportIds = new Set<string>();
let cognito: CognitoIdentityProviderClient;
let userPoolId: string;
let endpoint: string;
let fixtureReportId: string;
let amplifyConfigured = false;

function assertPersonalSandbox(): void {
  if (process.env.CRISISMAP_INTEGRATION_TARGET !== REQUIRED_TARGET) {
    throw new Error(
      `Refusing live API writes. Set CRISISMAP_INTEGRATION_TARGET=${REQUIRED_TARGET} only for a disposable personal sandbox.`,
    );
  }
  if (!config.auth?.aws_region || !config.auth.user_pool_id || !config.auth.user_pool_client_id) {
    throw new Error(
      'amplify_outputs.json has no deployed Auth configuration. Start `npx ampx sandbox` first.',
    );
  }
  if (!config.data?.url || !config.data.aws_region) {
    throw new Error(
      'amplify_outputs.json has no deployed Data configuration. Start `npx ampx sandbox` first.',
    );
  }
}

async function createRoleUser(role: UserRole): Promise<{ username: string; token: string }> {
  const username = `cris29-${role.toLowerCase()}-${RUN_ID}@example.com`;
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
  createdUsers.push(username);
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: username,
      Password: PASSWORD,
      Permanent: true,
    }),
  );
  await cognito.send(
    new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: username, GroupName: role }),
  );

  await signOut().catch(() => undefined);
  const signInResult = await signIn({ username, password: PASSWORD });
  if (!signInResult.isSignedIn) {
    throw new Error(
      `Test user ${role} did not complete sign-in (${signInResult.nextStep.signInStep}).`,
    );
  }
  const session = await fetchAuthSession({ forceRefresh: true });
  const token = session.tokens?.idToken?.toString();
  if (!token) throw new Error(`Cognito returned no ID token for the ${role} test user.`);
  await signOut();
  return { username, token };
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

function expectErrorPrefix(response: GraphQLResponse<unknown>, prefix: string): void {
  expect(response.errors?.some(({ message }) => message.startsWith(prefix))).toBe(true);
}

function tokenFor(role: UserRole): string {
  const token = tokens.get(role);
  if (!token) throw new Error(`No live-test token was created for ${role}.`);
  return token;
}

function usernameFor(role: UserRole): string {
  const username = usernames.get(role);
  if (!username) throw new Error(`No live-test username was created for ${role}.`);
  return username;
}

async function createCoordinatorFixture(): Promise<{
  reportId: string;
  assignmentId: string;
  teamId: string;
}> {
  const coordinatorToken = tokenFor(UserRole.COORDINATOR);
  const teamId = `cris29-team-${RUN_ID}`;
  const reportId = `cris29-report-${RUN_ID}`;
  const assignmentId = `cris29-assignment-${RUN_ID}`;

  requireData(
    await graphql<{ createTeam: { id: string } }>(
      coordinatorToken,
      `
        mutation CreateTeam($input: CreateTeamInput!) {
          createTeam(input: $input) {
            id
          }
        }
      `,
      { input: { id: teamId, name: 'CRIS-29 volunteers', regionId: 'cris29-region' } },
    ),
  );
  cleanupMutations.unshift({
    query: 'mutation DeleteTeam($input: DeleteTeamInput!) { deleteTeam(input: $input) { id } }',
    variables: { input: { id: teamId } },
  });

  requireData(
    await graphql<{ createReport: { id: string } }>(
      coordinatorToken,
      `
        mutation CreateReport($input: CreateReportInput!) {
          createReport(input: $input) {
            id
          }
        }
      `,
      {
        input: {
          id: reportId,
          text: 'PII sentinel: must not reach volunteer projection',
          reporterId: 'private-reporter-id',
          reporterContact: 'private-contact@example.com',
          status: ReportStatus.AI_CLASSIFIED,
          version: 1,
          isAnonymous: false,
          summary: 'Deliver emergency supplies',
          priorityScore: 8,
          priorityBand: 'P0',
          regionId: 'cris29-region',
          assignedTeamId: teamId,
        },
      },
    ),
  );
  cleanupMutations.unshift({
    query:
      'mutation DeleteReport($input: DeleteReportInput!) { deleteReport(input: $input) { id } }',
    variables: { input: { id: reportId } },
  });

  requireData(
    await graphql<{ createAssignment: { id: string } }>(
      coordinatorToken,
      `
        mutation CreateAssignment($input: CreateAssignmentInput!) {
          createAssignment(input: $input) {
            id
          }
        }
      `,
      {
        input: {
          id: assignmentId,
          reportId,
          teamId,
          status: 'ASSIGNED',
          version: 1,
          assignedById: 'cris29-coordinator',
        },
      },
    ),
  );
  cleanupMutations.unshift({
    query:
      'mutation DeleteAssignment($input: DeleteAssignmentInput!) { deleteAssignment(input: $input) { id } }',
    variables: { input: { id: assignmentId } },
  });

  return { reportId, assignmentId, teamId };
}

describe('live AppSync API contract', () => {
  beforeAll(async () => {
    assertPersonalSandbox();
    Amplify.configure(outputs);
    amplifyConfigured = true;
    userPoolId = config.auth!.user_pool_id!;
    endpoint = config.data!.url!;
    cognito = new CognitoIdentityProviderClient({ region: config.auth!.aws_region! });

    for (const role of [
      UserRole.CITIZEN,
      UserRole.VOLUNTEER,
      UserRole.RESPONDER,
      UserRole.COORDINATOR,
    ]) {
      const { username, token } = await createRoleUser(role);
      usernames.set(role, username);
      tokens.set(role, token);
    }
    fixtureReportId = (await createCoordinatorFixture()).reportId;
  });

  afterAll(async () => {
    const coordinatorToken = tokens.get(UserRole.COORDINATOR);
    if (coordinatorToken) {
      for (const cleanup of cleanupMutations) {
        await graphql(coordinatorToken, cleanup.query, cleanup.variables).catch(() => undefined);
      }
      for (const reportId of submittedReportIds) {
        await graphql(
          coordinatorToken,
          'mutation DeleteReport($input: DeleteReportInput!) { deleteReport(input: $input) { id } }',
          { input: { id: reportId } },
        ).catch(() => undefined);
      }
    }
    if (amplifyConfigured) await signOut().catch(() => undefined);
    if (cognito && userPoolId) {
      await Promise.allSettled(
        createdUsers.map((Username) =>
          cognito.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username })),
        ),
      );
    }
    cognito?.destroy();
  });

  it('submits idempotently and preserves the server-derived citizen identity', async () => {
    const clientRequestId = `cris29-submit-${RUN_ID}`;
    const mutation = `mutation SubmitReport($text: String!, $clientRequestId: String!, $reporterContact: String) {
      submitReport(text: $text, clientRequestId: $clientRequestId, reporterContact: $reporterContact) {
        id text status version reporterId reporterContact updatedAt
      }
    }`;
    const variables = {
      text: 'CRIS-29 live integration smoke report',
      clientRequestId,
      reporterContact: 'cris29-citizen@example.com',
    };
    const first = requireData(
      await graphql<{ submitReport: ReportResult }>(
        tokenFor(UserRole.CITIZEN),
        mutation,
        variables,
      ),
    ).submitReport;
    const replay = requireData(
      await graphql<{ submitReport: ReportResult }>(
        tokenFor(UserRole.CITIZEN),
        mutation,
        variables,
      ),
    ).submitReport;
    submittedReportIds.add(first.id);

    expect(replay.id).toBe(first.id);
    expect(first).toMatchObject({
      status: ReportStatus.NEW,
      version: 1,
      reporterContact: 'cris29-citizen@example.com',
    });
    expect(first.reporterId).toEqual(expect.any(String));
    expect(first.updatedAt).toEqual(expect.any(String));
  });

  it('accepts reporting clients through guest and authenticated Identity Pool auth', async () => {
    await signOut().catch(() => undefined);
    const reportingClient = generateClient<Schema>({ authMode: 'identityPool' });

    const guestResult = await reportingClient.mutations.submitReport({
      text: 'CRIS-29 guest Identity Pool report',
      clientRequestId: `cris29-guest-submit-${RUN_ID}`,
      isAnonymous: true,
      reporterContact: 'must-be-discarded@example.com',
    });
    if (guestResult.errors?.length || !guestResult.data) {
      throw new Error(
        `Guest Identity Pool submission failed: ${JSON.stringify(guestResult.errors ?? guestResult)}`,
      );
    }
    submittedReportIds.add(guestResult.data.id);
    expect(guestResult.data).toMatchObject({
      status: ReportStatus.NEW,
      reporterId: null,
      reporterContact: null,
      isAnonymous: true,
    });

    const citizenUsername = usernameFor(UserRole.CITIZEN);
    const signInResult = await signIn({ username: citizenUsername, password: PASSWORD });
    if (!signInResult.isSignedIn) {
      throw new Error(
        `Citizen did not complete sign-in (${signInResult.nextStep.signInStep}) for Identity Pool coverage.`,
      );
    }
    try {
      const authenticatedResult = await reportingClient.mutations.submitReport({
        text: 'CRIS-29 authenticated Identity Pool report',
        clientRequestId: `cris29-authenticated-submit-${RUN_ID}`,
        isAnonymous: false,
        reporterContact: 'cris29-identity-pool@example.com',
      });
      if (authenticatedResult.errors?.length || !authenticatedResult.data) {
        throw new Error(
          `Authenticated Identity Pool submission failed: ${JSON.stringify(
            authenticatedResult.errors ?? authenticatedResult,
          )}`,
        );
      }
      submittedReportIds.add(authenticatedResult.data.id);
      expect(authenticatedResult.data).toMatchObject({
        status: ReportStatus.NEW,
        reporterId: null,
        reporterContact: 'cris29-identity-pool@example.com',
        isAnonymous: false,
      });
    } finally {
      await signOut().catch(() => undefined);
    }
  });

  it('enforces role, legality, and optimistic locking on report transitions', async () => {
    const mutation = `mutation UpdateReportStatus($reportId: ID!, $toStatus: String!, $expectedVersion: Int!) {
      updateReportStatus(reportId: $reportId, toStatus: $toStatus, expectedVersion: $expectedVersion) {
        id status version updatedAt
      }
    }`;

    expectErrorPrefix(
      await graphql(tokenFor(UserRole.RESPONDER), mutation, {
        reportId: fixtureReportId,
        toStatus: ReportStatus.REJECTED,
        expectedVersion: 1,
      }),
      'FORBIDDEN:',
    );
    expectErrorPrefix(
      await graphql(tokenFor(UserRole.COORDINATOR), mutation, {
        reportId: fixtureReportId,
        toStatus: ReportStatus.RESOLVED,
        expectedVersion: 1,
      }),
      'ILLEGAL_TRANSITION:',
    );
    expectErrorPrefix(
      await graphql(tokenFor(UserRole.COORDINATOR), mutation, {
        reportId: fixtureReportId,
        toStatus: ReportStatus.VERIFIED,
        expectedVersion: 99,
      }),
      'CONFLICT:',
    );

    const updated = requireData(
      await graphql<{ updateReportStatus: ReportResult }>(
        tokenFor(UserRole.COORDINATOR),
        mutation,
        { reportId: fixtureReportId, toStatus: ReportStatus.VERIFIED, expectedVersion: 1 },
      ),
    ).updateReportStatus;
    expect(updated).toMatchObject({
      id: fixtureReportId,
      status: ReportStatus.VERIFIED,
      version: 2,
    });
  });

  it('exposes volunteer tasks without a wire representation for report PII', async () => {
    const response = requireData(
      await graphql<{ listVolunteerTasks: VolunteerTaskResult[] }>(
        tokenFor(UserRole.VOLUNTEER),
        `
          query ListVolunteerTasks {
            listVolunteerTasks {
              reportId
              status
              summary
              teamId
              teamName
              column
            }
          }
        `,
      ),
    );
    const task = response.listVolunteerTasks.find(({ reportId }) => reportId === fixtureReportId);
    expect(task).toMatchObject({
      summary: 'Deliver emergency supplies',
      teamName: 'CRIS-29 volunteers',
    });
    expect(task).not.toHaveProperty('text');
    expect(task).not.toHaveProperty('reporterId');
    expect(task).not.toHaveProperty('reporterContact');

    const rawReportAttempt = await graphql(
      tokenFor(UserRole.VOLUNTEER),
      'query ListReports { listReports { items { id text reporterContact } } }',
    );
    expect(
      rawReportAttempt.errors?.some(
        ({ errorType, message }) => errorType === 'Unauthorized' || /not authorized/i.test(message),
      ),
    ).toBe(true);
  });

  it('uploads a small object through the guest Identity Pool signed media POST policy', async () => {
    await signOut().catch(() => undefined);
    const reportingClient = generateClient<Schema>({ authMode: 'identityPool' });
    const uploadResult = await reportingClient.mutations.createMediaUploadUrl({
      clientRequestId: `cris29-media-${RUN_ID}`,
      contentType: 'image/png',
    });
    if (uploadResult.errors?.length || !uploadResult.data) {
      throw new Error(
        `Guest Identity Pool media presign failed: ${JSON.stringify(
          uploadResult.errors ?? uploadResult,
        )}`,
      );
    }
    const upload = uploadResult.data;
    const body = new FormData();
    const fields = parseMediaUploadFields(upload.fields);
    for (const [name, value] of Object.entries(fields)) body.append(name, value);
    body.append(
      'file',
      new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
      'x.png',
    );

    const response = await fetch(upload.url, { method: 'POST', body });
    expect(response.ok, await response.text()).toBe(true);
    expect(upload.key).toMatch(/^reports\/cris29-media-/);
  });
});
