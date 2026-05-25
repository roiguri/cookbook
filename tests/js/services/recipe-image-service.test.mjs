import { jest } from '@jest/globals';

import '../../common/mocks/firebase-firestore.mock.js';
import '../../common/mocks/firebase-storage.mock.js';
import '../../common/mocks/firebase-service.mock.js';

let RecipeImageService;

const firestoreMocks = {
  getDocument: jest.fn(),
  updateDocument: jest.fn(),
};

const storageMocks = {
  getMetadata: jest.fn(),
  getFileUrl: jest.fn(),
  uploadFile: jest.fn(),
  deleteFile: jest.fn(() => Promise.resolve()),
};

jest.unstable_mockModule('src/js/services/_firebase/firestore-service.js', () => ({
  FirestoreService: firestoreMocks,
}));
jest.unstable_mockModule('src/js/services/_firebase/storage-service.js', () => ({
  StorageService: storageMocks,
}));

beforeAll(() => {
  // jsdom doesn't ship `fetch`; the service calls it during the backup-fetch path.
  // Tests stub a Response-shaped object via this mock.
  global.fetch = jest.fn();
});

beforeEach(async () => {
  jest.resetModules();
  Object.values(firestoreMocks).forEach((m) => m.mockReset?.());
  Object.values(storageMocks).forEach((m) => m.mockReset?.());
  storageMocks.deleteFile.mockImplementation(() => Promise.resolve());
  global.fetch.mockReset();

  ({ RecipeImageService } = await import('src/js/services/recipes/recipe-image-service.js'));
});

describe('RecipeImageService', () => {
  describe('replaceImage', () => {
    const newBlob = new Blob(['enhanced'], { type: 'image/jpeg' });

    function setupRecipeWithImage() {
      firestoreMocks.getDocument.mockResolvedValue({
        id: 'recipe-9',
        images: [
          { id: 'img-1', full: 'img/recipes/full/desserts/recipe-9/img-1.jpg', isPrimary: true },
          { id: 'img-2', full: 'img/recipes/full/desserts/recipe-9/img-2.jpg' },
        ],
      });
    }

    it('throws if recipeId / imageId / blob is missing', async () => {
      await expect(RecipeImageService.replaceImage('', 'img-1', newBlob)).rejects.toThrow(
        'recipeId is required',
      );
      await expect(RecipeImageService.replaceImage('r', '', newBlob)).rejects.toThrow(
        'imageId is required',
      );
      await expect(RecipeImageService.replaceImage('r', 'i', null)).rejects.toThrow(
        'blob is required',
      );
    });

    it('throws if the recipe is not found', async () => {
      firestoreMocks.getDocument.mockResolvedValue(null);
      await expect(RecipeImageService.replaceImage('missing', 'img-1', newBlob)).rejects.toThrow(
        'recipe missing not found',
      );
    });

    it('throws if the image id is not on the recipe', async () => {
      setupRecipeWithImage();
      await expect(
        RecipeImageService.replaceImage('recipe-9', 'no-such-img', newBlob),
      ).rejects.toThrow('image no-such-img not found');
    });

    it('writes the backup when none exists, then overwrites the original', async () => {
      setupRecipeWithImage();
      // Backup missing → getMetadata rejects
      storageMocks.getMetadata.mockRejectedValueOnce(new Error('not-found'));
      storageMocks.getFileUrl.mockResolvedValue('https://storage/original-url');
      const originalBytes = new Blob(['original'], { type: 'image/jpeg' });
      global.fetch.mockResolvedValue({
        ok: true,
        blob: async () => originalBytes,
      });

      const result = await RecipeImageService.replaceImage('recipe-9', 'img-1', newBlob);

      expect(result.backupCreated).toBe(true);
      expect(result.backupPath).toBe('img/recipes/full/desserts/recipe-9/img-1_original.jpg');
      // 1st upload: backup
      expect(storageMocks.uploadFile).toHaveBeenNthCalledWith(
        1,
        originalBytes,
        'img/recipes/full/desserts/recipe-9/img-1_original.jpg',
      );
      // 2nd upload: enhanced overwrite at original path
      expect(storageMocks.uploadFile).toHaveBeenNthCalledWith(
        2,
        newBlob,
        'img/recipes/full/desserts/recipe-9/img-1.jpg',
      );
    });

    it('skips the backup write when one already exists', async () => {
      setupRecipeWithImage();
      // Backup already there → getMetadata resolves
      storageMocks.getMetadata.mockResolvedValue({ name: 'backup' });

      const result = await RecipeImageService.replaceImage('recipe-9', 'img-1', newBlob);

      expect(result.backupCreated).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
      // Only one upload: the overwrite
      expect(storageMocks.uploadFile).toHaveBeenCalledTimes(1);
      expect(storageMocks.uploadFile).toHaveBeenCalledWith(
        newBlob,
        'img/recipes/full/desserts/recipe-9/img-1.jpg',
      );
    });

    it('skips backup entirely when keepOriginalBackup is false', async () => {
      setupRecipeWithImage();

      await RecipeImageService.replaceImage('recipe-9', 'img-1', newBlob, {
        keepOriginalBackup: false,
      });

      expect(storageMocks.getMetadata).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
      // Only the overwrite upload
      expect(storageMocks.uploadFile).toHaveBeenCalledTimes(1);
    });

    it('deletes stale 400 and 1080 WebP variants after overwrite (best-effort)', async () => {
      setupRecipeWithImage();
      storageMocks.getMetadata.mockResolvedValue({});

      await RecipeImageService.replaceImage('recipe-9', 'img-1', newBlob);

      expect(storageMocks.deleteFile).toHaveBeenCalledWith(
        'img/recipes/full/desserts/recipe-9/img-1_400x400.webp',
      );
      expect(storageMocks.deleteFile).toHaveBeenCalledWith(
        'img/recipes/full/desserts/recipe-9/img-1_1080x1080.webp',
      );
    });

    it('applies fieldUpdates to the matching image entry on the recipe doc', async () => {
      setupRecipeWithImage();
      storageMocks.getMetadata.mockResolvedValue({});
      // 2nd getDocument (the fresh re-read for the patch) returns the same recipe
      firestoreMocks.getDocument.mockResolvedValue({
        id: 'recipe-9',
        images: [
          { id: 'img-1', full: 'img/recipes/full/desserts/recipe-9/img-1.jpg', isPrimary: true },
          { id: 'img-2', full: 'img/recipes/full/desserts/recipe-9/img-2.jpg' },
        ],
      });

      await RecipeImageService.replaceImage('recipe-9', 'img-1', newBlob, {
        fieldUpdates: { aiEnhanced: true },
      });

      const updateCall = firestoreMocks.updateDocument.mock.calls[0];
      expect(updateCall[0]).toBe('recipes');
      expect(updateCall[1]).toBe('recipe-9');
      const updatedImages = updateCall[2].images;
      expect(updatedImages.find((i) => i.id === 'img-1').aiEnhanced).toBe(true);
      // Untargeted images are unchanged
      expect(updatedImages.find((i) => i.id === 'img-2').aiEnhanced).toBeUndefined();
      expect(updatedImages.find((i) => i.id === 'img-1').isPrimary).toBe(true);
    });

    it('skips the doc patch when fieldUpdates is empty or missing', async () => {
      setupRecipeWithImage();
      storageMocks.getMetadata.mockResolvedValue({});

      await RecipeImageService.replaceImage('recipe-9', 'img-1', newBlob);
      expect(firestoreMocks.updateDocument).not.toHaveBeenCalled();

      await RecipeImageService.replaceImage('recipe-9', 'img-1', newBlob, {
        fieldUpdates: {},
      });
      expect(firestoreMocks.updateDocument).not.toHaveBeenCalled();
    });

    it('treats a fieldUpdates write failure as best-effort (logs, does not throw)', async () => {
      setupRecipeWithImage();
      storageMocks.getMetadata.mockResolvedValue({});
      firestoreMocks.updateDocument.mockRejectedValue(new Error('boom'));
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        RecipeImageService.replaceImage('recipe-9', 'img-1', newBlob, {
          fieldUpdates: { aiEnhanced: true },
        }),
      ).resolves.toMatchObject({ backupCreated: false });

      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it('throws when fetching the original for backup fails', async () => {
      setupRecipeWithImage();
      storageMocks.getMetadata.mockRejectedValue(new Error('no backup yet'));
      storageMocks.getFileUrl.mockResolvedValue('https://storage/url');
      global.fetch.mockResolvedValue({ ok: false, status: 403 });

      await expect(RecipeImageService.replaceImage('recipe-9', 'img-1', newBlob)).rejects.toThrow(
        'failed to fetch original (403)',
      );

      // Overwrite never happened
      expect(storageMocks.uploadFile).not.toHaveBeenCalled();
    });
  });
});
