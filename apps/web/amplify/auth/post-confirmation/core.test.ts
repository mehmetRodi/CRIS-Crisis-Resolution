import { describe, expect, it } from 'vitest';
import { shouldAutoAssignCitizen } from './core';

describe('shouldAutoAssignCitizen', () => {
  it('assigns on a fresh sign-up confirmation', () => {
    expect(shouldAutoAssignCitizen('PostConfirmation_ConfirmSignUp')).toBe(true);
  });

  it('does not re-assign on a forgot-password confirmation', () => {
    expect(shouldAutoAssignCitizen('PostConfirmation_ConfirmForgotPassword')).toBe(false);
  });
});
