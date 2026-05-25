import { jest } from '@jest/globals';

let validateImageFile,
  getImageStoragePath,
  getRecipeImages,
  getPlaceholderImageUrl,
  getPrimaryImage;

// Helper: create a fake File
function createFakeFile(name = 'test.jpg', type = 'image/jpeg', size = 1000) {
  const blob = new Blob(['a'.repeat(size)], { type });
  return new File([blob], name, { type });
}

describe('recipe-image-utils', () => {
  beforeAll(() => {
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');
  });

  beforeEach(async () => {
    jest.resetModules();
    const utils = await import('src/js/utils/recipes/recipe-image-utils.js');
    validateImageFile = utils.validateImageFile;
    getImageStoragePath = utils.getImageStoragePath;
    getRecipeImages = utils.getRecipeImages;
    getPlaceholderImageUrl = utils.getPlaceholderImageUrl;
    getPrimaryImage = utils.getPrimaryImage;
  });

  describe('validateImageFile', () => {
    it('validates correct file', () => {
      const file = createFakeFile();
      expect(validateImageFile(file)).toEqual({ isValid: true, errors: [] });
    });
    it('rejects missing file', () => {
      expect(validateImageFile(null).isValid).toBe(false);
    });
    it('rejects wrong type', () => {
      const file = createFakeFile('test.txt', 'text/plain');
      expect(validateImageFile(file).isValid).toBe(false);
    });
    it('rejects too large', () => {
      const file = createFakeFile('big.jpg', 'image/jpeg', 6 * 1024 * 1024);
      expect(validateImageFile(file).isValid).toBe(false);
    });
  });

  describe('getImageStoragePath', () => {
    it('generates correct path for full', () => {
      expect(getImageStoragePath('id1', 'cat', 'file.jpg', 'full')).toBe(
        'img/recipes/full/cat/id1/file.jpg',
      );
    });
  });

  describe('getRecipeImages', () => {
    it('filters images by access', () => {
      const recipe = {
        images: [
          { id: '1', access: 'public' },
          { id: '2', access: 'approved' },
          { id: '3', access: 'manager' },
        ],
      };
      expect(getRecipeImages(recipe, 'public').map((i) => i.id)).toEqual(['1']);
      expect(getRecipeImages(recipe, 'approved').map((i) => i.id)).toEqual(
        expect.arrayContaining(['2', '1']),
      );
      expect(getRecipeImages(recipe, 'manager').map((i) => i.id)).toEqual(
        expect.arrayContaining(['3', '2', '1']),
      );
    });
    it('returns [] for no images', () => {
      expect(getRecipeImages({}, 'public')).toEqual([]);
    });
  });

  describe('getPlaceholderImageUrl', () => {
    it('returns null', () => {
      expect(getPlaceholderImageUrl()).toBeNull();
    });
  });

  describe('getPrimaryImage', () => {
    it('returns the primary image if present', () => {
      const recipe = {
        images: [{ id: '1', isPrimary: false }, { id: '2', isPrimary: true }, { id: '3' }],
      };
      expect(getPrimaryImage(recipe)).toEqual({ id: '2', isPrimary: true });
    });
    it('returns the first image if no primary', () => {
      const recipe = { images: [{ id: '1' }, { id: '2' }] };
      expect(getPrimaryImage(recipe)).toEqual({ id: '1' });
    });
    it('returns undefined if no images', () => {
      expect(getPrimaryImage({ images: [] })).toBeUndefined();
      expect(getPrimaryImage({})).toBeUndefined();
      expect(getPrimaryImage(null)).toBeUndefined();
    });
  });
});
