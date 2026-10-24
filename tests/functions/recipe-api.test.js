/**
 * Recipe API (recipeApi, HTTP) read endpoints against the real function in the
 * Functions emulator, with tokens issued through createApiToken. Run with
 * `npm run test:functions`. Plan: docs/feature-plans/recipe-api.md, slice 3.
 */
import { doc, setDoc, getDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { startContext, FUNCTIONS_URL } from './helpers.js';

const ROLES = { manager: 'manager', me: 'approved', other: 'approved', plain: 'user' };
const API = `${FUNCTIONS_URL}/recipeApi`;

let ctx;
let uid;

/** Call the API. */
async function api(path, { token, method = 'GET', headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, headers: res.headers };
}

/** A token for `owner` (default: me), issued by the manager. */
async function issue(owner = 'me', scope = 'read') {
  return ctx.call.manager('createApiToken', { uid: uid[owner], name: `t-${owner}`, scope });
}

const recipe = (authorId, extra = {}) => ({
  name: 'Recipe',
  authorId,
  visibility: 'private',
  stage: 'tested',
  creationTime: Timestamp.fromMillis(Date.UTC(2026, 9, 1)),
  ...extra,
});
const seed = (id, data) => ctx.asAdmin((db) => setDoc(doc(db, 'recipes', id), data));

beforeAll(async () => {
  ctx = await startContext(ROLES);
  ({ uid } = ctx);
});

beforeEach(() => ctx.reset());

afterAll(() => ctx?.close());

describe('authentication', () => {
  it('requires a well-formed, known token', async () => {
    expect((await api('/v1/me')).status).toBe(401);
    expect((await api('/v1/me', { token: 'not-a-token' })).status).toBe(401);
    const unknown = `ckb_${'A'.repeat(43)}`;
    const res = await api('/v1/me', { token: unknown });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'unauthorized', message: expect.any(String) } });
  });

  it('does not route before authenticating', async () => {
    expect((await api('/v1/nowhere')).status).toBe(401);
  });

  it('identifies the owner and the token', async () => {
    const { token } = await issue('me', 'read');
    const res = await api('/v1/me', { token });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: { name: 'me user', role: 'approved' },
      token: { name: 't-me', scope: 'read' },
    });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('stops working once revoked', async () => {
    const { token, tokenId } = await issue();
    expect((await api('/v1/me', { token })).status).toBe(200);
    await ctx.call.manager('revokeApiToken', { tokenId });
    expect((await api('/v1/me', { token })).status).toBe(401);
  });

  it('stops working when the owner is demoted', async () => {
    const { token } = await issue();
    await ctx.asAdmin((db) => updateDoc(doc(db, 'users', uid.me), { role: 'user' }));
    const res = await api('/v1/me', { token });
    expect(res.status).toBe(403);
  });

  it('refuses a disabled owner', async () => {
    const { token } = await issue('other');
    await ctx.authAdmin.setDisabled(uid.other, true);
    try {
      expect((await api('/v1/recipes/mine', { token })).status).toBe(401);
    } finally {
      await ctx.authAdmin.setDisabled(uid.other, false);
    }
  });

  it('refuses a deleted owner without re-creating their account', async () => {
    const soloUid = await ctx.addUser(`solo${Date.now()}`, 'approved');
    const { token } = await ctx.call.manager('createApiToken', {
      uid: soloUid,
      name: 'solo',
      scope: 'read',
    });
    await ctx.authAdmin.delete(soloUid);
    expect((await api('/v1/recipes/mine', { token })).status).toBe(401);
    expect(await ctx.authAdmin.exists(soloUid)).toBe(false);
  });

  it('stamps lastUsedAt and counts the day', async () => {
    const { token, tokenId } = await issue();
    await api('/v1/me', { token });
    const stored = await ctx.asAdmin((db) => getDoc(doc(db, 'api_tokens', tokenId)));
    expect(stored.get('lastUsedAt')).toBeTruthy();
    expect(stored.get('usage')).toEqual({ [new Date().toISOString().slice(0, 10)]: 1 });
  });

  it('enforces the daily cap', async () => {
    const { token, tokenId } = await issue();
    const today = new Date().toISOString().slice(0, 10);
    await ctx.asAdmin((db) =>
      updateDoc(doc(db, 'api_tokens', tokenId), { usage: { [today]: 1000 } }),
    );
    const res = await api('/v1/me', { token });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('rate-limited');
  });
});

describe('routing', () => {
  it('404s unknown endpoints and 405s wrong methods', async () => {
    const { token } = await issue();
    expect((await api('/v1/nowhere', { token })).status).toBe(404);
    expect((await api('/v1/recipes/a/b', { token })).status).toBe(404);
    expect((await api('/v1/categories', { token, method: 'DELETE' })).status).toBe(405);
  });

  it('lists categories', async () => {
    const { token } = await issue();
    const res = await api('/v1/categories', { token });
    expect(res.status).toBe(200);
    expect(res.body.categories).toContainEqual({ id: 'desserts', label: 'קינוחים' });
  });
});

describe('GET /v1/recipes/{id}', () => {
  it('returns my recipe in the write shape, without internal fields', async () => {
    await seed(
      'r1',
      recipe(uid.me, {
        name: 'שקשוקה',
        description: 'ארוחת בוקר',
        category: 'main-courses',
        ingredients: [{ item: 'ביצים', amount: 6, unit: '' }],
        instructions: ['מטגנים'],
        comments: ['טעים'],
        relatedRecipes: ['x'],
        userId: uid.me,
        approved: false,
        createdVia: { kind: 'api', tokenId: 't' },
      }),
    );
    const { token } = await issue();
    const res = await api('/v1/recipes/r1', { token });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: 'r1',
      path: '/recipe/r1',
      visibility: 'private',
      stage: 'tested',
      isMine: true,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: null,
      testedAt: null,
      recipe: {
        name: 'שקשוקה',
        description: 'ארוחת בוקר',
        category: 'main-courses',
        ingredients: [{ item: 'ביצים', amount: 6, unit: '' }],
        instructions: ['מטגנים'],
        comments: ['טעים'],
        relatedRecipes: ['x'],
      },
      images: [],
      mediaInstructions: [],
    });
    expect(JSON.stringify(res.body)).not.toMatch(/authorId|userId|createdVia|approved/);
  });

  it("hides someone else's private recipe as not found", async () => {
    await seed('theirs', recipe(uid.other));
    const { token } = await issue();
    const res = await api('/v1/recipes/theirs', { token });
    expect(res.status).toBe(404);
    expect((await api('/v1/recipes/missing', { token })).status).toBe(404);
  });

  it('reads published recipes and recipes shared with me', async () => {
    await seed('pub', recipe(uid.other, { visibility: 'published' }));
    await seed('shared', recipe(uid.other));
    await ctx.asAdmin((db) =>
      setDoc(doc(db, 'recipes', 'shared', 'shares', uid.me), {
        authorId: uid.other,
        sharedAt: Timestamp.now(),
      }),
    );
    const { token } = await issue();
    const pub = await api('/v1/recipes/pub', { token });
    expect(pub.status).toBe(200);
    expect(pub.body.isMine).toBe(false);
    expect((await api('/v1/recipes/shared', { token })).status).toBe(200);
  });

  it('resolves image and media URLs as the user', async () => {
    const path = 'recipes/r2/images/img-1.jpg';
    await ctx.asAdmin((_db, storage) =>
      uploadBytes(ref(storage, path), new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
        contentType: 'image/jpeg',
        customMetadata: { uploadedBy: uid.me },
      }),
    );
    await seed(
      'r2',
      recipe(uid.me, {
        images: [
          { id: 'img-1', full: path, isPrimary: true },
          { id: 'img-2', full: 'recipes/r2/images/missing.jpg', isPrimary: false },
        ],
        mediaInstructions: [
          { id: 'm2', path: 'recipes/r2/media/b.mp4', type: 'video', caption: 'שני', order: 1 },
          { id: 'm1', path, type: 'image', caption: 'ראשון', order: 0 },
        ],
      }),
    );
    const { token } = await issue();
    const res = await api('/v1/recipes/r2', { token });
    expect(res.status).toBe(200);
    expect(res.body.images[0]).toEqual({ id: 'img-1', isPrimary: true, url: expect.any(String) });
    expect(res.body.images[0].url).toContain('img-1.jpg');
    expect(res.body.images[1].url).toBeNull();
    expect(res.body.mediaInstructions.map((m) => m.caption)).toEqual(['ראשון', 'שני']);
  });
});

describe('GET /v1/recipes/mine', () => {
  beforeEach(async () => {
    await seed('a', recipe(uid.me, { name: 'A', stage: 'to-try' }));
    await seed(
      'b',
      recipe(uid.me, { name: 'B', creationTime: Timestamp.fromMillis(Date.UTC(2026, 9, 5)) }),
    );
    await seed('c', recipe(uid.other, { name: 'C', visibility: 'published' }));
  });

  it('lists only my recipes, newest first, as summaries', async () => {
    const { token } = await issue();
    const res = await api('/v1/recipes/mine', { token });
    expect(res.status).toBe(200);
    expect(res.body.recipes.map((r) => r.id)).toEqual(['b', 'a']);
    expect(res.body.recipes[0]).toEqual({
      id: 'b',
      name: 'B',
      category: null,
      stage: 'tested',
      visibility: 'private',
      isMine: true,
      createdAt: '2026-10-05T00:00:00.000Z',
      path: '/recipe/b',
    });
  });

  it('filters by stage and rejects an unknown stage', async () => {
    const { token } = await issue();
    const toTry = await api('/v1/recipes/mine?stage=to-try', { token });
    expect(toTry.body.recipes.map((r) => r.id)).toEqual(['a']);
    expect((await api('/v1/recipes/mine?stage=done', { token })).status).toBe(400);
  });
});

describe('GET /v1/recipes (published)', () => {
  beforeEach(async () => {
    await seed(
      'p1',
      recipe(uid.other, { name: 'עוגת שוקולד', visibility: 'published', category: 'desserts' }),
    );
    await seed(
      'p2',
      recipe(uid.me, { name: 'מרק עדשים', visibility: 'published', category: 'soups-stews' }),
    );
    await seed('private', recipe(uid.me, { name: 'עוגה פרטית' }));
  });

  it('lists published recipes only, with category and name filters', async () => {
    const { token } = await issue();
    const all = await api('/v1/recipes', { token });
    expect(all.body.recipes.map((r) => r.id).sort()).toEqual(['p1', 'p2']);
    const desserts = await api('/v1/recipes?category=desserts', { token });
    expect(desserts.body.recipes.map((r) => r.id)).toEqual(['p1']);
    const search = await api(`/v1/recipes?q=${encodeURIComponent('מרק')}`, { token });
    expect(search.body.recipes.map((r) => r.id)).toEqual(['p2']);
    expect((await api('/v1/recipes?category=nope', { token })).status).toBe(400);
  });
});

describe('managers read like family through the API', () => {
  beforeEach(async () => {
    await seed('their-private', recipe(uid.other, { name: 'Private' }));
    await seed('their-published', recipe(uid.other, { name: 'Pub', visibility: 'published' }));
    await seed('manager-own', recipe(uid.manager, { name: 'Mine' }));
    await seed('shared-with-manager', recipe(uid.other, { name: 'Shared' }));
    await ctx.asAdmin((db) =>
      setDoc(doc(db, 'recipes', 'shared-with-manager', 'shares', uid.manager), {
        authorId: uid.other,
        sharedAt: Timestamp.now(),
      }),
    );
  });

  it("a manager token cannot open another member's private recipe", async () => {
    const { token } = await issue('manager');
    expect((await api('/v1/recipes/their-private', { token })).status).toBe(404);
  });

  it('but reads its own, published and shared recipes', async () => {
    const { token } = await issue('manager');
    for (const id of ['manager-own', 'their-published', 'shared-with-manager']) {
      expect((await api(`/v1/recipes/${id}`, { token })).status).toBe(200);
    }
    const mine = await api('/v1/recipes/mine', { token });
    expect(mine.body.recipes.map((r) => r.id)).toEqual(['manager-own']);
  });
});

describe('scopes and parameters', () => {
  it('a read+write token can read', async () => {
    const { token } = await issue('me', 'read+write');
    expect((await api('/v1/recipes/mine', { token })).status).toBe(200);
    expect((await api('/v1/me', { token })).body.token.scope).toBe('read+write');
  });

  it('rejects a repeated filter', async () => {
    const { token } = await issue();
    expect((await api('/v1/recipes/mine?stage=tested&stage=to-try', { token })).status).toBe(400);
    expect((await api('/v1/recipes?category=desserts&category=salads', { token })).status).toBe(
      400,
    );
  });

  it('gives legacy or missing files and malformed entries no URL instead of failing', async () => {
    await seed(
      'legacy',
      recipe(uid.me, {
        images: [
          { id: 'old', full: 'img/recipes/full/x/old.jpg' },
          null,
          'junk',
          { id: 'no-path' },
        ],
        mediaInstructions: [
          null,
          { type: 'image', caption: 'x', path: 'recipes/legacy/media/gone.jpg' },
        ],
      }),
    );
    const { token } = await issue();
    const res = await api('/v1/recipes/legacy', { token });
    expect(res.status).toBe(200);
    expect(res.body.images).toEqual([
      { id: 'old', isPrimary: false, url: null },
      { id: 'no-path', isPrimary: false, url: null },
    ]);
    expect(res.body.mediaInstructions).toEqual([{ type: 'image', caption: 'x', url: null }]);
  });
});

describe('concurrency', () => {
  it('parallel requests from two owners each see only their own data', async () => {
    await seed('me-1', recipe(uid.me, { name: 'Me' }));
    await seed('other-1', recipe(uid.other, { name: 'Other' }));
    const mine = await issue('me');
    const theirs = await issue('other');
    const calls = [];
    for (let i = 0; i < 6; i++) {
      for (const [who, token, expected] of [
        ['me', mine.token, 'me-1'],
        ['other', theirs.token, 'other-1'],
      ]) {
        calls.push(
          api('/v1/recipes/mine', { token }).then((r) => ({ who, expected, r })),
          api('/v1/me', { token }).then((r) => ({ who, r })),
        );
      }
    }
    for (const { who, expected, r } of await Promise.all(calls)) {
      expect(r.status).toBe(200);
      if (expected) expect(r.body.recipes.map((x) => x.id)).toEqual([expected]);
      else expect(r.body.user.name).toBe(`${who} user`);
    }
  });

  it('a burst on one token succeeds and every request is counted', async () => {
    const { token, tokenId } = await issue();
    const results = await Promise.all(Array.from({ length: 10 }, () => api('/v1/me', { token })));
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
    const stored = await ctx.asAdmin((db) => getDoc(doc(db, 'api_tokens', tokenId)));
    expect(stored.get('usage')).toEqual({ [new Date().toISOString().slice(0, 10)]: 10 });
  });
});
