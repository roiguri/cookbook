import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const errors = require('../../../functions/api/errors.js');
const { bearerToken, usageUpdate } = require('../../../functions/api/auth.js');
const { iso, toSummary, toFullRecipe } = require('../../../functions/api/format.js');
const { matchRoute } = require('../../../functions/api/routes.js');

const TOKEN = `ckb_${'a'.repeat(43)}`;

describe('recipe API (functions/api)', () => {
  describe('errors', () => {
    it('maps API errors to their status and code', () => {
      expect(errors.toResponse(errors.notFound('Recipe not found.'))).toEqual({
        status: 404,
        body: { error: { code: 'not-found', message: 'Recipe not found.' } },
      });
      expect(errors.toResponse(errors.rateLimited('x')).status).toBe(429);
    });

    it('maps Firestore failures the caller should hear about', () => {
      const fs = (code, message = '') => Object.assign(new Error(message), { code });
      expect(errors.fromFirestoreError(fs('permission-denied')).status).toBe(403);
      const big = errors.fromFirestoreError(
        fs('invalid-argument', 'Document exceeds the maximum allowed size of 1,048,576 bytes.'),
      );
      expect([big.status, big.code]).toEqual([400, 'recipe-too-large']);
      expect(errors.fromFirestoreError(fs('aborted')).status).toBe(503);
      // Anything else stays as it is (a 500).
      const other = fs('internal');
      expect(errors.fromFirestoreError(other)).toBe(other);
      const api = errors.conflict('x');
      expect(errors.fromFirestoreError(api)).toBe(api);
    });

    it('hides anything else behind a generic 500', () => {
      const res = errors.toResponse(new Error('db path recipes/secret failed'));
      expect(res.status).toBe(500);
      expect(JSON.stringify(res)).not.toContain('secret');
    });
  });

  describe('bearerToken', () => {
    it('accepts only "Bearer <well-formed token>"', () => {
      expect(bearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
      expect(bearerToken(`bearer ${TOKEN} `)).toBe(TOKEN);
      expect(bearerToken(TOKEN)).toBeNull();
      expect(bearerToken(`Bearer ${TOKEN}x`)).toBeNull();
      expect(bearerToken(`Basic ${TOKEN}`)).toBeNull();
      expect(bearerToken(undefined)).toBeNull();
    });
  });

  describe('usageUpdate (daily cap)', () => {
    const now = new Date('2026-10-24T12:00:00Z');
    const ops = { increment: (n) => ({ increment: n }), remove: () => 'DELETE' };

    it("always increments today's counter, never resets it", () => {
      expect(usageUpdate({}, now, ops, 3)).toEqual({ 'usage.2026-10-24': { increment: 1 } });
      expect(usageUpdate({ usage: { '2026-10-24': 2 } }, now, ops, 3)).toEqual({
        'usage.2026-10-24': { increment: 1 },
      });
    });

    it("drops earlier days' counters", () => {
      expect(usageUpdate({ usage: { '2026-10-22': 9, '2026-10-23': 3 } }, now, ops, 3)).toEqual({
        'usage.2026-10-24': { increment: 1 },
        'usage.2026-10-22': 'DELETE',
        'usage.2026-10-23': 'DELETE',
      });
    });

    it('refuses at the cap', () => {
      expect(usageUpdate({ usage: { '2026-10-24': 3 } }, now, ops, 3)).toBeNull();
    });
  });

  describe('format', () => {
    const at = { toDate: () => new Date('2026-10-01T00:00:00Z') };

    it('turns timestamps, dates and millis into ISO strings', () => {
      expect(iso(at)).toBe('2026-10-01T00:00:00.000Z');
      expect(iso(Date.UTC(2026, 9, 1))).toBe('2026-10-01T00:00:00.000Z');
      expect(iso(null)).toBeNull();
      expect(iso('garbage')).toBeNull();
    });

    it('summarizes a recipe without its author', () => {
      const summary = toSummary('r1', { name: 'X', authorId: 'u1', creationTime: at }, 'u1');
      expect(summary).toEqual({
        id: 'r1',
        name: 'X',
        category: null,
        stage: 'tested',
        visibility: 'private',
        isMine: true,
        createdAt: '2026-10-01T00:00:00.000Z',
        path: '/recipe/r1',
      });
    });

    it('nests only content fields under recipe', () => {
      const full = toFullRecipe(
        'r1',
        { name: 'X', comments: ['c'], authorId: 'u2', userId: 'u2', createdVia: {}, junk: 1 },
        'u1',
        ['name', 'comments', 'description'],
        { images: [], mediaInstructions: [] },
      );
      expect(full.recipe).toEqual({ name: 'X', comments: ['c'] });
      expect(full.isMine).toBe(false);
      expect(JSON.stringify(full)).not.toMatch(/u2|createdVia|junk/);
    });
  });

  describe('matchRoute', () => {
    it('routes reads, with /recipes/mine before /recipes/{id}', () => {
      expect(matchRoute('GET', '/v1/recipes/mine').route.handler).toBe('listMine');
      expect(matchRoute('GET', '/v1/recipes/abc').params).toEqual({ id: 'abc' });
      expect(matchRoute('GET', '/v1/recipes/').route.handler).toBe('listPublished');
      expect(matchRoute('GET', '/v1/me').route.handler).toBe('me');
      const create = matchRoute('POST', '/v1/recipes').route;
      expect(create.handler).toBe('createRecipe');
      expect(create.scopes).toEqual(['read+write']);
      expect(create.body).toBe(true);
    });

    it('rejects unknown paths and other methods', () => {
      expect(matchRoute('GET', '/v1/recipes/a/b')).toBeNull();
      expect(matchRoute('GET', '/v1/recipes/a.b')).toBeNull();
      // Firestore's reserved ids would be a 500; they are simply not recipes.
      expect(matchRoute('GET', '/v1/recipes/__x__')).toBeNull();
      expect(matchRoute('POST', '/v1/me')).toEqual({ methodNotAllowed: true });
    });
  });
});
