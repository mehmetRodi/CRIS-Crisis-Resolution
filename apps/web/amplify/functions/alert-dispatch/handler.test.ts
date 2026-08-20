import { describe, expect, it } from 'vitest';
import { PriorityBand } from '@crisismap/shared';
import { recipientIdFromOwner } from './core';
import { parseMessage } from './handler';

describe('parseMessage', () => {
  it('accepts only P0/P1 threshold-crossing projections', () => {
    expect(
      parseMessage(JSON.stringify({ reportId: 'report-1', priorityBand: PriorityBand.P1 })),
    ).toEqual({ reportId: 'report-1', priorityBand: PriorityBand.P1 });
    expect(
      parseMessage(JSON.stringify({ reportId: 'report-1', priorityBand: PriorityBand.P2 })),
    ).toBeNull();
    expect(parseMessage('{')).toBeNull();
  });
});

describe('recipientIdFromOwner', () => {
  it('extracts the stable Cognito sub from Amplify owner values', () => {
    expect(recipientIdFromOwner('sub-123::citizen@example.com')).toBe('sub-123');
  });

  it('preserves legacy/plain usernames', () => {
    expect(recipientIdFromOwner('citizen@example.com')).toBe('citizen@example.com');
  });
});
