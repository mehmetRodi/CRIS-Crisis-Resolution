import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => {
  class AdminAddUserToGroupCommand {
    constructor(readonly input: Record<string, string>) {}
  }

  class AdminListGroupsForUserCommand {
    constructor(readonly input: Record<string, string>) {}
  }

  return {
    send: vi.fn(),
    AdminAddUserToGroupCommand,
    AdminListGroupsForUserCommand,
  };
});

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  AdminAddUserToGroupCommand: sdk.AdminAddUserToGroupCommand,
  AdminListGroupsForUserCommand: sdk.AdminListGroupsForUserCommand,
  CognitoIdentityProviderClient: class {
    send = sdk.send;
  },
}));

import { handler } from './handler';

function event(triggerSource: string) {
  return {
    triggerSource,
    userPoolId: 'eu-west-1_pool',
    userName: 'user-1',
    request: { userAttributes: {} },
    response: {},
  } as Parameters<typeof handler>[0];
}

describe('citizen role assignment handler', () => {
  beforeEach(() => {
    sdk.send.mockReset();
  });

  it('assigns CITIZEN immediately after sign-up confirmation', async () => {
    sdk.send.mockResolvedValueOnce({});

    await handler(event('PostConfirmation_ConfirmSignUp'));

    expect(sdk.send).toHaveBeenCalledOnce();
    expect(sdk.send.mock.calls[0]?.[0]).toBeInstanceOf(sdk.AdminAddUserToGroupCommand);
    expect(sdk.send.mock.calls[0]?.[0]).toMatchObject({
      input: { UserPoolId: 'eu-west-1_pool', Username: 'user-1', GroupName: 'CITIZEN' },
    });
  });

  it('does not alter roles after forgot-password confirmation', async () => {
    await handler(event('PostConfirmation_ConfirmForgotPassword'));

    expect(sdk.send).not.toHaveBeenCalled();
  });

  it('leaves an authenticated staff account unchanged', async () => {
    sdk.send.mockResolvedValueOnce({ Groups: [{ GroupName: 'RESPONDER' }] });

    await handler(event('PostAuthentication_Authentication'));

    expect(sdk.send).toHaveBeenCalledOnce();
    expect(sdk.send.mock.calls[0]?.[0]).toBeInstanceOf(sdk.AdminListGroupsForUserCommand);
  });

  it('repairs a role-less account after authentication', async () => {
    sdk.send.mockResolvedValueOnce({ Groups: [] }).mockResolvedValueOnce({});

    await handler(event('PostAuthentication_Authentication'));

    expect(sdk.send).toHaveBeenCalledTimes(2);
    expect(sdk.send.mock.calls[0]?.[0]).toBeInstanceOf(sdk.AdminListGroupsForUserCommand);
    expect(sdk.send.mock.calls[1]?.[0]).toBeInstanceOf(sdk.AdminAddUserToGroupCommand);
  });

  it('logs and returns when Cognito is temporarily unavailable', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sdk.send.mockRejectedValueOnce(new Error('throttled'));
    const input = event('PostConfirmation_ConfirmSignUp');

    await expect(handler(input)).resolves.toBe(input);
    expect(error).toHaveBeenCalledWith(
      'Failed to auto-assign CITIZEN group',
      expect.objectContaining({
        userPoolId: 'eu-west-1_pool',
        triggerSource: 'PostConfirmation_ConfirmSignUp',
        err: 'throttled',
      }),
    );
    error.mockRestore();
  });
});
