/**
 * Recipe API — POST /v1/recipes with photos and step media (multipart), against the
 * real function and the Storage emulator. Run with `npm run test:functions`.
 * Plan: docs/feature-plans/recipe-api.md, slice 5.
 */
import { doc, getDoc } from 'firebase/firestore';
import { ref, listAll, getMetadata } from 'firebase/storage';
import { startContext, FUNCTIONS_URL } from './helpers.js';

const ROLES = { manager: 'manager', me: 'approved' };
const API = `${FUNCTIONS_URL}/recipeApi`;

const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9,
]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const GIF = new TextEncoder().encode('GIF89a\x01\x00\x01\x00');
const MP4 = new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode('ftypmp42'), 0, 0, 0, 0]);
const TEXT = new TextEncoder().encode('<html>not an image</html>');

const complete = {
  name: 'פוקאצ׳ה',
  category: 'breads-pastries',
  difficulty: 'בינונית',
  prepTime: 30,
  waitTime: 120,
  servings: 6,
  ingredients: [{ item: 'קמח', amount: 500, unit: 'גרם' }],
  instructions: ['ללוש', 'לאפות'],
};

let ctx;
let uid;
let writer;

/** POST multipart: `request` JSON plus { partName: [bytes, type, filename] }. */
async function postFiles(request, parts = {}, { token = writer.token } = {}) {
  const form = new FormData();
  form.append('request', JSON.stringify(request));
  for (const [name, [bytes, type, filename = `${name}.bin`]] of Object.entries(parts)) {
    form.append(name, new Blob([bytes], { type }), filename);
  }
  const res = await fetch(`${API}/v1/recipes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const fields = (res) => (res.body?.error?.details || []).map((d) => d.field);
const stored = (id) => ctx.asAdmin((db) => getDoc(doc(db, 'recipes', id)));
/** Every file under recipes/{id}/. */
const filesOf = (id) =>
  ctx.asAdmin(async (_db, storage) => {
    const folders = await Promise.all(
      ['images', 'media'].map((f) => listAll(ref(storage, `recipes/${id}/${f}`))),
    );
    return folders.flatMap((f) => f.items.map((item) => item.fullPath));
  });

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

describe('photos and step media', () => {
  it("stores them as the user, in the app's layout and entry shapes", async () => {
    const res = await postFiles(
      {
        id: 'with-files-1',
        recipe: complete,
        images: [{ part: 'photo' }, { part: 'photo2', isPrimary: true }],
        mediaInstructions: [{ part: 'clip', caption: ' ללוש היטב ' }, { part: 'anim' }],
      },
      {
        photo: [JPEG, 'image/jpeg', 'top.jpg'],
        photo2: [PNG, 'image/png', 'side.png'],
        clip: [MP4, 'video/mp4', 'שלב 1.mp4'],
        anim: [GIF, 'image/gif', 'fold.gif'],
      },
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 'with-files-1', images: 2, mediaInstructions: 2 });

    const saved = (await stored('with-files-1')).data();
    expect(saved.images).toEqual([
      {
        id: expect.stringMatching(/^img-/),
        full: expect.stringMatching(/^recipes\/with-files-1\/images\/img-.+\.jpg$/),
        fileName: expect.stringMatching(/\.jpg$/),
        isPrimary: false,
        uploadedBy: uid.me,
        access: 'public',
        uploadTimestamp: expect.anything(),
      },
      expect.objectContaining({ isPrimary: true, full: expect.stringMatching(/\.png$/) }),
    ]);
    expect(saved.mediaInstructions).toEqual([
      {
        id: expect.stringMatching(/^media-/),
        path: expect.stringMatching(/^recipes\/with-files-1\/media\/media-.+_1\.mp4$/),
        type: 'video',
        caption: 'ללוש היטב',
        order: 0,
        uploadedBy: uid.me,
        uploadedAt: expect.anything(),
      },
      expect.objectContaining({ type: 'image', caption: '', order: 1 }),
    ]);

    // Each file is in Storage, tagged with its uploader, with its checked type.
    const meta = await ctx.asAdmin((_db, storage) =>
      getMetadata(ref(storage, saved.images[1].full)),
    );
    expect(meta.contentType).toBe('image/png');
    expect(meta.customMetadata).toEqual({ uploadedBy: uid.me });
    expect((await filesOf('with-files-1')).length).toBe(4);

    // And readable back with URLs.
    const read = await fetch(`${API}/v1/recipes/with-files-1`, {
      headers: { Authorization: `Bearer ${writer.token}` },
    }).then((r) => r.json());
    expect(read.images.every((img) => typeof img.url === 'string')).toBe(true);
    expect(read.mediaInstructions.map((m) => m.caption)).toEqual(['ללוש היטב', '']);
  });

  it('works without files over multipart too', async () => {
    const res = await postFiles({ recipe: complete });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ images: 0, mediaInstructions: 0 });
  });

  it('refuses invalid files and uploads nothing', async () => {
    const res = await postFiles(
      {
        id: 'bad-files-1',
        recipe: complete,
        images: [{ part: 'gif' }, { part: 'fake' }],
      },
      { gif: [GIF, 'image/gif'], fake: [TEXT, 'image/jpeg'], stray: [JPEG, 'image/jpeg'] },
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid-files');
    expect(fields(res)).toEqual(['images[0]', 'images[1]', 'stray']);
    expect(await filesOf('bad-files-1')).toEqual([]);
  });

  it('checks the recipe before any file is uploaded', async () => {
    const res = await postFiles(
      { id: 'incomplete-1', recipe: { name: 'x' }, images: [{ part: 'p' }] },
      { p: [JPEG, 'image/jpeg'] },
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('incomplete-recipe');
    expect(await filesOf('incomplete-1')).toEqual([]);
  });

  it('checks related recipes before any file is uploaded', async () => {
    const res = await postFiles(
      {
        id: 'bad-link-1',
        recipe: { ...complete, relatedRecipes: ['no-such-recipe'] },
        images: [{ part: 'p' }],
      },
      { p: [JPEG, 'image/jpeg'] },
    );
    expect(res.status).toBe(400);
    expect(fields(res)).toEqual(['relatedRecipes[0]']);
    expect(await filesOf('bad-link-1')).toEqual([]);
  });

  it('a request that loses a same-id race removes its files', async () => {
    const request = { id: 'race-files-1', recipe: complete, images: [{ part: 'p' }] };
    const results = await Promise.all(
      Array.from({ length: 4 }, () => postFiles(request, { p: [JPEG, 'image/jpeg'] })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 201]);
    // Only the winner's photo is left, and it is the one the recipe points to.
    const saved = (await stored('race-files-1')).data();
    expect(await filesOf('race-files-1')).toEqual([saved.images[0].full]);
  });

  it('a retry with the same id uploads nothing and reports the recipe as it is', async () => {
    const request = { id: 'retry-files-1', recipe: complete, images: [{ part: 'p' }] };
    expect((await postFiles(request, { p: [JPEG, 'image/jpeg'] })).status).toBe(201);
    const again = await postFiles(request, { p: [JPEG, 'image/jpeg'] });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ created: false, images: 1, mediaInstructions: 0 });
    expect((await filesOf('retry-files-1')).length).toBe(1);
  });

  it("names files from their checked type, not the client's name", async () => {
    const res = await postFiles(
      {
        id: 'odd-names-1',
        recipe: complete,
        images: [{ part: 'p' }],
        mediaInstructions: [{ part: 'v' }],
      },
      {
        p: [JPEG, 'image/jpeg', 'evil.html'],
        v: [MP4, 'video/mp4', `${'x'.repeat(300)}.exe`],
      },
    );
    expect(res.status).toBe(201);
    const saved = (await stored('odd-names-1')).data();
    expect(saved.images[0].full).toMatch(/\.jpg$/);
    expect(saved.mediaInstructions[0].path).toMatch(/_x{40}\.mp4$/);
  });

  it('refuses an oversized caption before uploading anything', async () => {
    const res = await postFiles(
      {
        id: 'big-caption-1',
        recipe: complete,
        mediaInstructions: [{ part: 'v', caption: 'א'.repeat(500 * 1024) }],
      },
      { v: [MP4, 'video/mp4'] },
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('recipe-too-large');
    expect(await filesOf('big-caption-1')).toEqual([]);
  });

  it('sends files only as multipart, with a valid request part', async () => {
    const json = await fetch(`${API}/v1/recipes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${writer.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipe: complete, images: [{ part: 'p' }] }),
    });
    expect(json.status).toBe(400);
    expect((await json.json()).error.message).toMatch(/multipart/);

    const noRequest = new FormData();
    noRequest.append('p', new Blob([JPEG], { type: 'image/jpeg' }), 'p.jpg');
    const res = await fetch(`${API}/v1/recipes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${writer.token}` },
      body: noRequest,
    });
    expect(res.status).toBe(400);

    const badJson = new FormData();
    badJson.append('request', '{"recipe":');
    const res2 = await fetch(`${API}/v1/recipes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${writer.token}` },
      body: badJson,
    });
    expect(res2.status).toBe(400);
  });
});
