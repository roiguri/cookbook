import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tokens = require('../../../functions/utils/api-tokens.js');

describe('api tokens (functions/utils/api-tokens.js)', () => {
  it('generates distinct ckb_ tokens with 256 bits of randomness', () => {
    const a = tokens.generateToken();
    const b = tokens.generateToken();
    expect(a).toMatch(/^ckb_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('hashes with SHA-256 (hex), deterministically', () => {
    expect(tokens.hashToken('ckb_x')).toMatch(/^[0-9a-f]{64}$/);
    expect(tokens.hashToken('ckb_x')).toBe(tokens.hashToken('ckb_x'));
    expect(tokens.hashToken('ckb_x')).not.toBe(tokens.hashToken('ckb_y'));
  });

  const valid = () => ({ uid: 'abcDEF123', name: ' Jarvis ', scope: 'read+write' });

  describe('validateCreateInput', () => {
    it('accepts valid input and trims the name', () => {
      expect(tokens.validateCreateInput(valid())).toEqual({
        ok: true,
        value: { uid: 'abcDEF123', name: 'Jarvis', scope: 'read+write' },
      });
    });

    it.each([
      ['missing data', undefined],
      ['a path as uid', { ...valid(), uid: 'users/abc' }],
      ['an empty name', { ...valid(), name: '  ' }],
      ['a long name', { ...valid(), name: 'x'.repeat(61) }],
      ['an unknown scope', { ...valid(), scope: 'admin' }],
      ['a non-string name', { ...valid(), name: 5 }],
      ['a name of only bidi controls', { ...valid(), name: '\u202E\u2066' }],
    ])('rejects %s', (_label, input) => {
      expect(tokens.validateCreateInput(input).ok).toBe(false);
    });
  });

  it('strips bidi controls and invisible characters from names', () => {
    const result = tokens.validateCreateInput({ ...valid(), name: 'Jar\u202Evis\u2069' });
    expect(result.value.name).toBe('Jarvis');
    const hidden = tokens.validateCreateInput({
      ...valid(),
      name: '\u200BJar\u061Cvis\uFEFF\u200D',
    });
    expect(hidden.value.name).toBe('Jarvis');
  });

  it('accepts only plain document ids', () => {
    expect(tokens.isDocId('aZ09_-')).toBe(true);
    expect(tokens.isDocId('a/b')).toBe(false);
    expect(tokens.isDocId('')).toBe(false);
    expect(tokens.isDocId(7)).toBe(false);
  });

  it('stores the hash and a short display prefix, never the token', () => {
    const token = tokens.generateToken();
    const record = tokens.tokenRecord({
      token,
      uid: 'u1',
      name: 'Jarvis',
      scope: 'read',
      createdBy: 'm1',
      createdAt: 'T',
    });
    expect(record).toEqual({
      hash: tokens.hashToken(token),
      prefix: token.slice(0, 8),
      uid: 'u1',
      name: 'Jarvis',
      scope: 'read',
      createdBy: 'm1',
      createdAt: 'T',
      lastUsedAt: null,
    });
    expect(JSON.stringify(record)).not.toContain(token);
  });

  it('shows managers everything but the hash', () => {
    const at = { toMillis: () => 1000 };
    const shown = tokens.toPublicToken('t1', {
      hash: 'secret-hash',
      prefix: 'ckb_abcd',
      uid: 'u1',
      name: 'Jarvis',
      scope: 'read',
      createdBy: 'm1',
      createdAt: at,
      lastUsedAt: null,
    });
    expect(shown).toEqual({
      tokenId: 't1',
      uid: 'u1',
      name: 'Jarvis',
      scope: 'read',
      prefix: 'ckb_abcd',
      createdBy: 'm1',
      createdAt: 1000,
      lastUsedAt: null,
    });
    expect(JSON.stringify(shown)).not.toContain('secret-hash');
  });

  it('caps tokens per user at 3', () => {
    expect(tokens.MAX_TOKENS_PER_USER).toBe(3);
  });
});
