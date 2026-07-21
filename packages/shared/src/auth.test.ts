import { describe, expect, it } from 'vitest';

import { PASSWORD_MIN_LENGTH, isPasswordValid } from './auth';

describe('isPasswordValid', () => {
  it('accepts a password meeting every requirement', () => {
    expect(isPasswordValid('Passw0rd')).toBe(true);
  });

  it('rejects passwords shorter than the minimum length', () => {
    expect('Ab3'.length).toBeLessThan(PASSWORD_MIN_LENGTH);
    expect(isPasswordValid('Ab3')).toBe(false);
  });

  it('requires an uppercase letter', () => {
    expect(isPasswordValid('passw0rd')).toBe(false);
  });

  it('requires a lowercase letter', () => {
    expect(isPasswordValid('PASSW0RD')).toBe(false);
  });

  it('requires a digit', () => {
    expect(isPasswordValid('Password')).toBe(false);
  });
});
