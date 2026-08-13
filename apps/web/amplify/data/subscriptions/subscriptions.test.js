import { beforeEach, describe, expect, it, vi } from 'vitest';
import { request as regionRequest, response as regionResponse } from './by-region.js';
import { request as statusRequest, response as statusResponse } from './by-status.js';
import { request as updateRequest, response as updateResponse } from './on-report-update.js';

const mocks = vi.hoisted(() => ({
  setSubscriptionFilter: vi.fn(),
  toSubscriptionFilter: vi.fn((filter) => ({ compiled: filter })),
}));

vi.mock('@aws-appsync/utils', () => ({
  extensions: { setSubscriptionFilter: mocks.setSubscriptionFilter },
  util: { transform: { toSubscriptionFilter: mocks.toSubscriptionFilter } },
}));

describe('report update subscription resolvers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes through the unfiltered stream', () => {
    expect(updateRequest()).toEqual({});
    expect(updateResponse({ result: { reportId: 'report-1' } })).toEqual({
      reportId: 'report-1',
    });
  });

  it.each([
    ['regionId', regionRequest, regionResponse, 'north'],
    ['status', statusRequest, statusResponse, 'NEEDS_VERIFICATION'],
  ])('installs an equality filter for %s', (field, request, response, value) => {
    expect(request()).toEqual({ payload: null });
    expect(response({ args: { [field]: value } })).toBeNull();
    expect(mocks.toSubscriptionFilter).toHaveBeenCalledWith({ [field]: { eq: value } });
    expect(mocks.setSubscriptionFilter).toHaveBeenCalledWith({
      compiled: { [field]: { eq: value } },
    });
  });
});
