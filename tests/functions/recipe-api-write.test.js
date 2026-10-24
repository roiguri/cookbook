/**
 * Recipe API — POST /v1/recipes against the real function in the Functions emulator.
 * Run with `npm run test:functions`. Plan: docs/feature-plans/recipe-api.md, slice 4.
 */
import { doc, setDoc, getDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { startContext, FUNCTIONS_URL } from './helpers.js';

const ROLES = { manager: 'manager', me: 'approved', other: 'approved' };
const API = `${FUNCTIONS_URL}/recipeApi`;

let ctx;
let uid;
let writer; // { token, tokenId } — `me`, read+write

async function post(body, { token = writer.token, contentType = 'application/json', raw } = {}) {
  const res = await fetch(`${API}/v1/recipes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body: raw ?? JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const get = async (path, token = writer.token) => {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
};
const stored = (collection, id) => ctx.asAdmin((db) => getDoc(doc(db, collection, id)));
const fields = (res) => (res.body.error.details || []).map((d) => d.field);
const seedRecipe = (id, data) =>
  ctx.asAdmin((db) =>
    setDoc(doc(db, 'recipes', id), { stage: 'tested', creationTime: Timestamp.now(), ...data }),
  );

// Everything the recipe form requires.
const complete = {
  name: 'עוגת תפוחים',
  category: 'desserts',
  difficulty: 'קלה',
  prepTime: 20,
  waitTime: 45,
  servings: 8,
  ingredients: [{ item: 'תפוחים', amount: 4, unit: '' }],
  instructions: ['לקלף', 'לאפות'],
};
const recipe = (extra = {}) => ({ ...complete, ...extra });

beforeAll(async () => {
  ctx = await startContext(ROLES);
  ({ uid } = ctx);
});

beforeEach(async () => {
  await ctx.reset();
  writer = await ctx.call.manager('createApiToken', {
    uid: uid.me,
    name: 'writer',
    scope: 'read+write',
  });
});

afterAll(() => ctx?.close());

describe('creating a recipe', () => {
  it('saves a complete recipe as private and "to try" by default', async () => {
    const res = await post({ recipe: complete });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      path: `/recipe/${res.body.id}`,
      stage: 'to-try',
      submitted: false,
      created: true,
      images: 0,
      mediaInstructions: 0,
    });
    const saved = (await stored('recipes', res.body.id)).data();
    expect(saved).toEqual({
      ...complete,
      authorId: uid.me,
      visibility: 'private',
      stage: 'to-try',
      creationTime: expect.anything(),
      createdVia: { kind: 'api', tokenId: writer.tokenId },
    });
    expect((await stored('recipe_submissions', res.body.id)).exists()).toBe(false);
  });

  it('saves as tested, readable back in the same shape', async () => {
    const res = await post({ stage: 'tested', recipe: complete });
    expect(res.status).toBe(201);
    const read = await get(`/v1/recipes/${res.body.id}`);
    expect(read.body.recipe).toEqual(complete);
    expect(read.body.stage).toBe('tested');
    // Like a create in the app: no testedAt.
    expect(read.body.testedAt).toBeNull();
  });

  it('accepts ingredient sections and instruction stages', async () => {
    const res = await post({
      recipe: recipe({
        ingredients: undefined,
        instructions: undefined,
        ingredientSections: [
          { title: 'בצק', items: [{ item: 'קמח', amount: '1½', unit: 'כוסות' }] },
          { title: 'מילוי', items: [{ item: 'תפוחים', amount: 3 }] },
        ],
        stages: [
          { title: 'הכנה', instructions: ['ללוש'] },
          { title: 'אפייה', instructions: ['לאפות'] },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const saved = (await stored('recipes', res.body.id)).data();
    expect(saved.ingredientSections[0].items[0]).toEqual({
      item: 'קמח',
      amount: 1.5,
      unit: 'כוסות',
    });
    expect(saved.stages.map((s) => s.title)).toEqual(['הכנה', 'אפייה']);
    expect(saved.ingredients).toBeUndefined();
    expect(saved.instructions).toBeUndefined();
  });

  it('submits for approval in the same write', async () => {
    const res = await post({ submit: true, recipe: complete });
    expect(res.status).toBe(201);
    expect(res.body.submitted).toBe(true);
    expect((await stored('recipe_submissions', res.body.id)).data()).toEqual({
      recipeId: res.body.id,
      authorId: uid.me,
      status: 'pending',
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
      createdAt: expect.anything(),
    });
    expect((await stored('recipes', res.body.id)).get('visibility')).toBe('private');
  });

  it('links published related recipes', async () => {
    await seedRecipe('pub-1', { name: 'p', authorId: uid.other, visibility: 'published' });
    const res = await post({ recipe: recipe({ relatedRecipes: ['pub-1'] }) });
    expect(res.status).toBe(201);
    expect((await stored('recipes', res.body.id)).get('relatedRecipes')).toEqual(['pub-1']);
  });
});

describe('validation', () => {
  it('requires a complete recipe, as the form does', async () => {
    const res = await post({ recipe: { name: 'x', ingredients: [{ item: 'a' }] } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('incomplete-recipe');
    expect(fields(res)).toEqual(['category', 'difficulty', 'prepTime', 'servings', 'instructions']);
  });

  it('applies every field rule, reporting each problem', async () => {
    const res = await post({
      recipe: {
        name: '',
        category: 'Desserts',
        difficulty: 'easy',
        prepTime: 0,
        servings: 2.5,
        tags: ['a,b'],
        ingredients: [{ item: 'a', amount: '2-3' }],
        instructions: 'step',
      },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid-recipe');
    expect(fields(res)).toEqual(
      expect.arrayContaining([
        'name',
        'category',
        'difficulty',
        'prepTime',
        'servings',
        'tags',
        'ingredients[0].amount',
        'instructions',
      ]),
    );
  });

  it('enforces one format per list, and sections of at least two', async () => {
    const both = await post({
      recipe: recipe({
        ingredientSections: [
          { title: 't', items: [{ item: 'b' }] },
          { title: 'u', items: [{ item: 'c' }] },
        ],
      }),
    });
    expect(fields(both)).toEqual(['ingredients']);
    const oneStage = await post({
      recipe: recipe({ instructions: undefined, stages: [{ title: 'only', instructions: ['a'] }] }),
    });
    expect(fields(oneStage)).toEqual(['stages']);
  });

  it('only links published recipes, never itself', async () => {
    await seedRecipe('theirs-private', { name: 'p', authorId: uid.other, visibility: 'private' });
    await seedRecipe('my-private', { name: 'm', authorId: uid.me, visibility: 'private' });
    const res = await post({
      recipe: recipe({ relatedRecipes: ['missing', 'theirs-private', 'my-private'] }),
    });
    expect(res.status).toBe(400);
    expect(fields(res)).toEqual(['relatedRecipes[0]', 'relatedRecipes[1]', 'relatedRecipes[2]']);
    const self = await post({
      id: 'self-link-1',
      recipe: recipe({ relatedRecipes: ['self-link-1'] }),
    });
    expect(fields(self)).toEqual(['relatedRecipes']);
  });

  it('rejects owner, visibility and other server-owned fields', async () => {
    const res = await post({
      recipe: recipe({ authorId: uid.other, visibility: 'published', stage: 'tested' }),
    });
    expect(res.status).toBe(400);
    expect(fields(res)).toEqual(['authorId', 'visibility', 'stage']);
  });

  it('rejects unknown body fields, media, and bad options', async () => {
    expect((await post({ recipe: complete, publish: true })).status).toBe(400);
    const media = await post({ recipe: complete, images: [] });
    expect(media.status).toBe(400);
    expect(media.body.error.message).toMatch(/multipart/);
    expect((await post({ recipe: complete, stage: 'done' })).status).toBe(400);
    expect((await post({ recipe: complete, submit: 'yes' })).status).toBe(400);
    expect((await post({ recipe: complete, id: 'a/b' })).status).toBe(400);
    expect((await post({ recipe: complete, id: '__reserved__' })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post([])).status).toBe(400);
  });

  it('requires a JSON body', async () => {
    expect((await post(null, { contentType: 'text/plain', raw: 'name' })).status).toBe(415);
    expect((await post(null, { raw: '{"recipe":' })).status).toBe(400);
  });

  it('refuses a recipe too large to store, without a 500', async () => {
    // Small in the body, but each row grows (amount, unit) past Firestore's 1 MiB.
    const rows = Array.from({ length: 50000 }, () => ({ item: 'ab' }));
    const res = await post({ recipe: recipe({ ingredients: rows }) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('recipe-too-large');
  });
});

describe('retries and ids', () => {
  it('the same id again returns the existing recipe, unchanged', async () => {
    const first = await post({ id: 'my-recipe-1', submit: true, recipe: complete });
    expect(first.status).toBe(201);
    const again = await post({ id: 'my-recipe-1', recipe: recipe({ name: 'different' }) });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({
      id: 'my-recipe-1',
      path: '/recipe/my-recipe-1',
      stage: 'to-try',
      submitted: true,
      created: false,
      images: 0,
      mediaInstructions: 0,
    });
    expect((await stored('recipes', 'my-recipe-1')).get('name')).toBe(complete.name);
  });

  it('refuses a retry that asks to submit a recipe saved without a submission', async () => {
    expect((await post({ id: 'not-sent-1', recipe: complete })).status).toBe(201);
    const res = await post({ id: 'not-sent-1', submit: true, recipe: complete });
    expect(res.status).toBe(409);
    expect((await stored('recipe_submissions', 'not-sent-1')).exists()).toBe(false);
  });

  it('two concurrent posts with one id create it once', async () => {
    const [a, b] = await Promise.all([
      post({ id: 'race-0001', recipe: complete }),
      post({ id: 'race-0001', recipe: complete }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
  });

  it("refuses an id that is someone else's recipe", async () => {
    await seedRecipe('theirs-private', { name: 'p', authorId: uid.other, visibility: 'private' });
    await seedRecipe('theirs-public', { name: 'q', authorId: uid.other, visibility: 'published' });
    expect((await post({ id: 'theirs-private', recipe: complete })).status).toBe(409);
    expect((await post({ id: 'theirs-public', recipe: complete })).status).toBe(409);
    expect((await stored('recipes', 'theirs-private')).get('name')).toBe('p');
  });
});

describe('access', () => {
  it('a read-only token cannot create', async () => {
    const { token } = await ctx.call.manager('createApiToken', {
      uid: uid.me,
      name: 'reader',
      scope: 'read',
    });
    expect((await post({ recipe: complete }, { token })).status).toBe(403);
  });

  it("a manager's token creates a private recipe in the manager's own name", async () => {
    const mgr = await ctx.call.manager('createApiToken', {
      uid: uid.manager,
      name: 'mgr',
      scope: 'read+write',
    });
    const res = await post({ recipe: complete }, { token: mgr.token });
    expect(res.status).toBe(201);
    const saved = (await stored('recipes', res.body.id)).data();
    expect(saved.authorId).toBe(uid.manager);
    expect(saved.visibility).toBe('private');
    expect(saved.createdVia).toEqual({ kind: 'api', tokenId: mgr.tokenId });
  });

  it('writes count against the daily cap', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await ctx.asAdmin((db) =>
      updateDoc(doc(db, 'api_tokens', writer.tokenId), { usage: { [today]: 999 } }),
    );
    expect((await post({ recipe: complete })).status).toBe(201);
    expect((await post({ recipe: complete })).status).toBe(429);
  });
});
