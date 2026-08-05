import { describe, expect, it } from 'vitest';
import { hasKnownRole, shouldEnsureCitizenRole } from './core';

describe('shouldEnsureCitizenRole', () => {
  it('assigns on a fresh sign-up confirmation', () => {
    expect(shouldEnsureCitizenRole('PostConfirmation_ConfirmSignUp')).toBe(true);
  });

  it('reconciles a missing role after authentication', () => {
    expect(shouldEnsureCitizenRole('PostAuthentication_Authentication')).toBe(true);
  });

  it('does not re-assign on a forgot-password confirmation', () => {
    expect(shouldEnsureCitizenRole('PostConfirmation_ConfirmForgotPassword')).toBe(false);
  });
});

describe('hasKnownRole', () => {
  const roles = ['CITIZEN', 'VOLUNTEER', 'RESPONDER', 'COORDINATOR', 'ADMIN'];

  it('recognizes an existing application role', () => {
    expect(hasKnownRole([{ GroupName: 'COORDINATOR' }], roles)).toBe(true);
  });

  it('treats missing and unrelated groups as role-less', () => {
    expect(hasKnownRole(undefined, roles)).toBe(false);
    expect(hasKnownRole([{ GroupName: 'OTHER' }, {}], roles)).toBe(false);
  });
});
