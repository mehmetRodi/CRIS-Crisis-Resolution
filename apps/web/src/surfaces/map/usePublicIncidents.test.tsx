import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePublicIncidents } from './usePublicIncidents';
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  staffList: vi.fn(),
  getCurrentUser: vi.fn(),
  client: {} as Record<string, unknown>,
}));
vi.mock('aws-amplify/auth', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('../../lib/amplify', () => ({ client: mocks.client }));

describe('Public map read boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ userId: 'volunteer' });
    mocks.client.queries = { listPublicReports: mocks.query };
    mocks.client.models = { Report: { list: mocks.staffList } };
    mocks.query.mockResolvedValue({ data: [], errors: [] });
  });
  it('uses the public query with authenticated access for a signed-in volunteer', async () => {
    const { result } = renderHook(() => usePublicIncidents());
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(mocks.query).toHaveBeenCalledWith({ limit: 250 }, { authMode: 'userPool' });
    expect(mocks.staffList).not.toHaveBeenCalled();
  });
  it('uses guest access when no session is available', async () => {
    mocks.getCurrentUser.mockRejectedValue(new Error('No session'));
    const { result } = renderHook(() => usePublicIncidents());
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(mocks.query).toHaveBeenCalledWith({ limit: 250 }, { authMode: 'identityPool' });
  });
  it('reports an unavailable service without falling back to private staff records', async () => {
    mocks.client.queries = {};
    const { result } = renderHook(() => usePublicIncidents());
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(mocks.staffList).not.toHaveBeenCalled();
  });
});
