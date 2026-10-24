import { createRequire } from 'node:module';
import * as model from '../../../src/js/shared/recipe-model.js';

const require = createRequire(import.meta.url);
const {
  uploadPlanned,
  removeFiles,
  photoName,
  mediaName,
  photoVariants,
} = require('../../../functions/api/uploads.js');

const session = { storage: 'S', uid: 'u1' };
const file = (mimeType, filename = 'x') => ({ data: Buffer.from('x'), mimeType, filename });
const plan = (images, media = []) => ({
  images: images.map((f, i) => ({ file: f, isPrimary: i === 0 })),
  media: media.map((f) => ({ file: f, type: model.mediaTypeOf(f.mimeType), caption: '' })),
});

describe('recipe API uploads (functions/api/uploads.js)', () => {
  it('names photos by their checked type, not the client name', () => {
    expect(photoName('image/jpeg')).toBe('photo.jpg');
    expect(model.imageFileName('img-1', photoName('image/webp'))).toBe('img-1.webp');
  });

  it("sanitizes and shortens media names, with the type's extension", () => {
    expect(mediaName('שלב 1.mp4', 'video/mp4')).toBe('____1.mp4');
    expect(mediaName('clip', 'video/quicktime')).toBe('clip.mov');
    expect(mediaName('', 'image/gif')).toBe('media.gif');
    expect(mediaName(`${'a'.repeat(500)}.html`, 'video/webm')).toBe(`${'a'.repeat(40)}.webm`);
  });

  it("lists a photo's thumbnail variants", () => {
    expect(photoVariants('recipes/r/images/img-1.jpg')).toEqual([
      'recipes/r/images/img-1_400x400.webp',
      'recipes/r/images/img-1_1080x1080.webp',
    ]);
  });

  it('stores every file and returns the entries in order', async () => {
    const paths = [];
    const result = await uploadPlanned(
      session,
      'r1',
      plan([file('image/png', 'evil.html')], [file('video/mp4', 'a.mp4')]),
      model,
      { upload: async (_s, path) => paths.push(path) },
    );
    expect(result.images[0].full).toMatch(/^recipes\/r1\/images\/img-.+\.png$/);
    expect(result.mediaInstructions[0].path).toMatch(/^recipes\/r1\/media\/media-.+_a\.mp4$/);
    expect(result.uploaded.sort()).toEqual(paths.sort());
  });

  it('when one upload fails, waits for the rest and removes every one that landed', async () => {
    const removed = [];
    let slowLanded = false;
    const upload = async (_s, path, data) => {
      if (data.toString() === 'fail')
        throw Object.assign(new Error('x'), { code: 'storage/unknown' });
      if (data.toString() === 'slow') {
        await new Promise((r) => setTimeout(r, 30));
        slowLanded = true;
      }
    };
    const files = [
      { data: Buffer.from('fail'), mimeType: 'image/jpeg', filename: 'a' },
      { data: Buffer.from('slow'), mimeType: 'image/jpeg', filename: 'b' },
      { data: Buffer.from('fast'), mimeType: 'image/png', filename: 'c' },
    ];
    await expect(
      uploadPlanned(session, 'r1', plan(files), model, {
        upload,
        remove: async (_s, path) => removed.push(path),
      }),
    ).rejects.toMatchObject({ code: 'storage/unknown' });
    expect(slowLanded).toBe(true);
    // The slow and the fast photo, each with its two thumbnail variants.
    expect(removed).toHaveLength(6);
    expect(
      removed.filter((p) => !p.includes('_400x400') && !p.includes('_1080x1080')),
    ).toHaveLength(2);
  });

  it('turns a storage rules refusal into a 403', async () => {
    await expect(
      uploadPlanned(session, 'r1', plan([file('image/jpeg')]), model, {
        upload: async () => {
          throw Object.assign(new Error('x'), { code: 'storage/unauthorized' });
        },
        remove: async () => {},
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('removes media files without inventing variants, and ignores failures', async () => {
    const removed = [];
    await removeFiles(session, ['recipes/r/media/m_a.mp4', 'recipes/r/images/i.jpg'], {
      remove: async (_s, path) => {
        removed.push(path);
        throw new Error('already gone');
      },
    });
    expect(removed).toEqual([
      'recipes/r/media/m_a.mp4',
      'recipes/r/images/i.jpg',
      'recipes/r/images/i_400x400.webp',
      'recipes/r/images/i_1080x1080.webp',
    ]);
  });
});
