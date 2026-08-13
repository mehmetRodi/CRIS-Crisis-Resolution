/**
 * Builders for AppSync resolver events (ADR-0044).
 *
 * Handler integration tests exercise the real `handler.ts` modules, so they
 * need structurally-complete `AppSyncResolverEvent`s and Cognito identities —
 * the parts of the wire contract the unit-tested `core.ts` layer never sees.
 */
import type {
  AppSyncIdentity,
  AppSyncIdentityCognito,
  AppSyncResolverEvent,
  AppSyncResolverHandler,
  Context,
} from 'aws-lambda';

/**
 * A userPool caller as AppSync presents it. `groups` stays `null` unless given —
 * a self-signed-up citizen carries no Cognito groups (ADR-0041).
 */
export function cognitoIdentity(
  overrides: Partial<AppSyncIdentityCognito> = {},
): AppSyncIdentityCognito {
  return {
    sub: 'user-sub-1',
    issuer: 'https://cognito-idp.eu-central-1.amazonaws.com/test-pool',
    username: 'user-1',
    claims: {},
    sourceIp: ['127.0.0.1'],
    defaultAuthStrategy: 'ALLOW',
    groups: null,
    ...overrides,
  };
}

/** A resolver event carrying `args` and, when given, an identity (null = guest/IAM-less). */
export function appSyncEvent<TArgs>(
  args: TArgs,
  identity: AppSyncIdentity | null = null,
): AppSyncResolverEvent<TArgs> {
  return {
    arguments: args,
    identity: identity ?? undefined,
    source: null,
    request: { headers: {}, domainName: null },
    info: {
      selectionSetList: [],
      selectionSetGraphQL: '',
      parentTypeName: 'Mutation',
      fieldName: 'testField',
      variables: {},
    },
    prev: null,
    stash: {},
  } as AppSyncResolverEvent<TArgs>;
}

/** Invoke a resolver handler the way Lambda does, returning its resolved value. */
export async function invokeHandler<TArgs, TResult>(
  handler: AppSyncResolverHandler<TArgs, TResult>,
  event: AppSyncResolverEvent<TArgs>,
): Promise<TResult> {
  const result = await handler(event, {} as Context, () => undefined);
  return result as TResult;
}
