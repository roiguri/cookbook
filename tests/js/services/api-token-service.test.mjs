import { jest } from '@jest/globals';

const callable = jest.fn();

jest.unstable_mockModule('src/js/services/_firebase/firebase-service.js', () => ({
  getFirebaseApp: jest.fn(() => ({})),
}));
jest.unstable_mockModule('firebase/functions', () => ({
  getFunctions: jest.fn(() => ({})),
  httpsCallable: jest.fn(
    (_fns, name) =>
      (...args) =>
        callable(name, ...args),
  ),
}));

let ApiTokenService;

beforeEach(async () => {
  jest.resetModules();
  callable.mockReset();
  ({ ApiTokenService } = await import('src/js/services/admin/api-token-service.js'));
});

describe('ApiTokenService', () => {
  it('list returns the tokens and the per-user cap', async () => {
    callable.mockResolvedValue({ data: { tokens: [{ tokenId: 't1' }], maxPerUser: 3 } });
    await expect(ApiTokenService.list()).resolves.toEqual({
      tokens: [{ tokenId: 't1' }],
      maxPerUser: 3,
    });
    expect(callable).toHaveBeenCalledWith('listApiTokens', undefined);
  });

  it('list tolerates an empty result', async () => {
    callable.mockResolvedValue({ data: null });
    await expect(ApiTokenService.list()).resolves.toEqual({ tokens: [], maxPerUser: 0 });
  });

  it('create sends only uid, name and scope, and returns the secret once', async () => {
    callable.mockResolvedValue({ data: { token: 'ckb_s', tokenId: 't1' } });
    const result = await ApiTokenService.create({
      uid: 'u1',
      name: 'Jarvis',
      scope: 'read',
      extra: 'x',
    });
    expect(callable).toHaveBeenCalledWith('createApiToken', {
      uid: 'u1',
      name: 'Jarvis',
      scope: 'read',
    });
    expect(result).toEqual({ token: 'ckb_s', tokenId: 't1' });
  });

  it('revoke sends the token id', async () => {
    callable.mockResolvedValue({ data: { revoked: 't1' } });
    await ApiTokenService.revoke('t1');
    expect(callable).toHaveBeenCalledWith('revokeApiToken', { tokenId: 't1' });
  });

  it('passes function errors through', async () => {
    callable.mockRejectedValue(Object.assign(new Error('x'), { code: 'functions/internal' }));
    await expect(ApiTokenService.revoke('t1')).rejects.toMatchObject({
      code: 'functions/internal',
    });
  });
});
