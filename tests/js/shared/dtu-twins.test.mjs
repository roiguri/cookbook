import {
  isResizableRecipePhoto,
  variantPathsFor,
  resizeToWebpBuffer,
} from '../../../factory/dtu/resize-twin/server.mjs';
import { toFirestoreValue, fromFirestoreValue } from '../../../factory/dtu/seed-server/server.mjs';
import { buildSeedDataset, SAMPLE_PNG_BUFFER } from '../../../factory/dtu/seed-server/fixtures.mjs';

describe('Cookbook DTU pure helpers', () => {
  it('detects resizable recipe photos and skips already-resized WebP variants', () => {
    expect(isResizableRecipePhoto('recipes/r1/images/photo.jpg')).toBe(true);
    expect(isResizableRecipePhoto('users/u1/recipes/r1/images/photo.png')).toBe(true);
    expect(isResizableRecipePhoto('recipes/r1/images/photo_400x400.webp')).toBe(false);
    expect(isResizableRecipePhoto('recipes/r1/media/clip.mp4')).toBe(false);
    expect(isResizableRecipePhoto('grandmas_cookbook/original/page.1.jpg')).toBe(false);
    expect(variantPathsFor('recipes/r1/images/photo.jpg')).toEqual([
      { size: 400, path: 'recipes/r1/images/photo_400x400.webp' },
      { size: 1080, path: 'recipes/r1/images/photo_1080x1080.webp' },
    ]);
  });

  it('produces valid RIFF/WEBP bytes when resizing a PNG', () => {
    const out = resizeToWebpBuffer(SAMPLE_PNG_BUFFER, 400);
    expect(out.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(out.subarray(8, 12).toString('ascii')).toBe('WEBP');
  });

  it('round-trips Firestore REST value codecs faithfully', () => {
    const sample = {
      name: 'שקשוקה',
      servings: 4,
      ratio: 0.5,
      ok: true,
      empty: null,
      tags: ['בוקר', 'מהיר'],
      nested: { a: 1 },
      when: new Date('2026-10-01T10:00:00.000Z'),
    };
    const roundTripped = fromFirestoreValue(toFirestoreValue(sample));
    expect(roundTripped).toEqual({
      ...sample,
      when: '2026-10-01T10:00:00.000Z',
    });
  });

  it('builds deterministic baseline and empty seed datasets', () => {
    const baseline = buildSeedDataset('baseline');
    expect(baseline.users).toHaveLength(4);
    expect(Object.keys(baseline.docs).length).toBeGreaterThan(20);
    expect(baseline.files.length).toBeGreaterThan(10);

    const empty = buildSeedDataset('empty');
    expect(empty.users).toHaveLength(4);
    expect(Object.keys(empty.docs)).toHaveLength(4);
    expect(empty.files).toHaveLength(0);
  });
});
