import {
  recipeImagesFolder,
  recipeMediaFolder,
  suggestionImagesFolder,
  suggestionMediaFolder,
  isRecipeStoragePath,
  rewriteStoragePaths,
} from '../../../../src/js/utils/recipes/storage-paths.js';

describe('storage-paths', () => {
  it('builds the per-recipe and per-suggestion folders', () => {
    expect(recipeImagesFolder('r1')).toBe('recipes/r1/images');
    expect(recipeMediaFolder('r1')).toBe('recipes/r1/media');
    expect(suggestionImagesFolder('s1')).toBe('suggestions/s1/images');
    expect(suggestionMediaFolder('s1')).toBe('suggestions/s1/media');
  });

  it('recognises current and legacy Storage paths, not URLs or previews', () => {
    expect(isRecipeStoragePath('recipes/r1/images/a.jpg')).toBe(true);
    expect(isRecipeStoragePath('suggestions/s1/images/a.jpg')).toBe(true);
    expect(isRecipeStoragePath('users/u1/recipes/r1/images/a.jpg')).toBe(true);
    expect(isRecipeStoragePath('img/recipes/full/mains/r1/a.jpg')).toBe(true);
    expect(isRecipeStoragePath('https://example.com/a.jpg')).toBe(false);
    expect(isRecipeStoragePath('blob:http://localhost/x')).toBe(false);
    expect(isRecipeStoragePath(undefined)).toBe(false);
  });

  describe('rewriteStoragePaths', () => {
    const mapping = {
      'img/recipes/full/mains/r1/a.jpg': 'recipes/r1/images/a.jpg',
      'recipes/r1/media-instructions/m.mp4': 'recipes/r1/media/m.mp4',
    };

    it('replaces mapped strings anywhere in nested objects and arrays', () => {
      const doc = {
        name: 'Soup',
        images: [
          { id: 'i1', full: 'img/recipes/full/mains/r1/a.jpg', isPrimary: true },
          { id: 'i2', full: 'recipes/r1/images/b.jpg' },
        ],
        mediaInstructions: [{ path: 'recipes/r1/media-instructions/m.mp4', order: 0 }],
        storagePaths: [{ type: 'image', path: 'img/recipes/full/mains/r1/a.jpg' }],
      };
      expect(rewriteStoragePaths(doc, mapping)).toEqual({
        name: 'Soup',
        images: [
          { id: 'i1', full: 'recipes/r1/images/a.jpg', isPrimary: true },
          { id: 'i2', full: 'recipes/r1/images/b.jpg' },
        ],
        mediaInstructions: [{ path: 'recipes/r1/media/m.mp4', order: 0 }],
        storagePaths: [{ type: 'image', path: 'recipes/r1/images/a.jpg' }],
      });
    });

    it('does not mutate the input', () => {
      const doc = { images: [{ full: 'img/recipes/full/mains/r1/a.jpg' }] };
      rewriteStoragePaths(doc, mapping);
      expect(doc.images[0].full).toBe('img/recipes/full/mains/r1/a.jpg');
    });

    it('keeps non-plain objects (e.g. Firestore Timestamps) as they are', () => {
      class Timestamp {
        constructor(seconds) {
          this.seconds = seconds;
        }
      }
      const ts = new Timestamp(5);
      expect(rewriteStoragePaths({ creationTime: ts }, mapping).creationTime).toBe(ts);
    });

    it('is not fooled by strings that name Object.prototype members', () => {
      expect(rewriteStoragePaths({ name: 'constructor', note: 'toString' }, mapping)).toEqual({
        name: 'constructor',
        note: 'toString',
      });
    });
  });
});
