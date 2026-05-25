import { jest } from '@jest/globals';

import '../../common/mocks/firebase-firestore.mock.js';
import '../../common/mocks/firebase-storage.mock.js';
import '../../common/mocks/firebase-service.mock.js';

let RecipeImageService;

const storageMocks = {
  getMetadata: jest.fn(),
  getFileUrl: jest.fn(),
  uploadFile: jest.fn(),
  deleteFile: jest.fn(() => Promise.resolve()),
};

jest.unstable_mockModule('src/js/services/_firebase/storage-service.js', () => ({
  StorageService: storageMocks,
}));

beforeAll(() => {
  // jsdom doesn't ship `fetch`; the service calls it during the backup-fetch path.
  global.fetch = jest.fn();
});

beforeEach(async () => {
  jest.resetModules();
  Object.values(storageMocks).forEach((m) => m.mockReset?.());
  storageMocks.deleteFile.mockImplementation(() => Promise.resolve());
  global.fetch.mockReset();

  ({ RecipeImageService } = await import('src/js/services/recipes/recipe-image-service.js'));
});

describe('RecipeImageService', () => {
  describe('replaceFiles', () => {
    const newBlob = new Blob(['enhanced'], { type: 'image/jpeg' });
    const image = { id: 'img-1', full: 'img/recipes/full/desserts/recipe-9/img-1.jpg' };

    it('throws if image.full is missing', async () => {
      await expect(RecipeImageService.replaceFiles('r', null, newBlob)).rejects.toThrow(
        'image.full is required',
      );
      await expect(RecipeImageService.replaceFiles('r', {}, newBlob)).rejects.toThrow(
        'image.full is required',
      );
    });

    it('throws if blob is missing', async () => {
      await expect(RecipeImageService.replaceFiles('r', image, null)).rejects.toThrow(
        'blob is required',
      );
    });

    it('writes the backup when none exists, then overwrites the original', async () => {
      storageMocks.getMetadata.mockRejectedValueOnce(new Error('not-found'));
      storageMocks.getFileUrl.mockResolvedValue('https://storage/original-url');
      const originalBytes = new Blob(['original'], { type: 'image/jpeg' });
      global.fetch.mockResolvedValue({ ok: true, blob: async () => originalBytes });

      const result = await RecipeImageService.replaceFiles('recipe-9', image, newBlob);

      expect(result).toEqual({
        backupPath: 'img/recipes/full/desserts/recipe-9/img-1_original.jpg',
        backupCreated: true,
      });
      expect(storageMocks.uploadFile).toHaveBeenNthCalledWith(
        1,
        originalBytes,
        'img/recipes/full/desserts/recipe-9/img-1_original.jpg',
      );
      expect(storageMocks.uploadFile).toHaveBeenNthCalledWith(
        2,
        newBlob,
        'img/recipes/full/desserts/recipe-9/img-1.jpg',
      );
    });

    it('skips the backup write when one already exists', async () => {
      storageMocks.getMetadata.mockResolvedValue({ name: 'backup' });

      const result = await RecipeImageService.replaceFiles('recipe-9', image, newBlob);

      expect(result.backupCreated).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(storageMocks.uploadFile).toHaveBeenCalledTimes(1);
      expect(storageMocks.uploadFile).toHaveBeenCalledWith(
        newBlob,
        'img/recipes/full/desserts/recipe-9/img-1.jpg',
      );
    });

    it('skips backup entirely when keepOriginalBackup is false', async () => {
      await RecipeImageService.replaceFiles('recipe-9', image, newBlob, {
        keepOriginalBackup: false,
      });

      expect(storageMocks.getMetadata).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(storageMocks.uploadFile).toHaveBeenCalledTimes(1);
    });

    it('deletes stale 400 and 1080 WebP variants after overwrite (best-effort)', async () => {
      storageMocks.getMetadata.mockResolvedValue({});

      await RecipeImageService.replaceFiles('recipe-9', image, newBlob);

      expect(storageMocks.deleteFile).toHaveBeenCalledWith(
        'img/recipes/full/desserts/recipe-9/img-1_400x400.webp',
      );
      expect(storageMocks.deleteFile).toHaveBeenCalledWith(
        'img/recipes/full/desserts/recipe-9/img-1_1080x1080.webp',
      );
    });

    it('throws when fetching the original for backup fails', async () => {
      storageMocks.getMetadata.mockRejectedValue(new Error('no backup yet'));
      storageMocks.getFileUrl.mockResolvedValue('https://storage/url');
      global.fetch.mockResolvedValue({ ok: false, status: 403 });

      await expect(RecipeImageService.replaceFiles('recipe-9', image, newBlob)).rejects.toThrow(
        'failed to fetch original (403)',
      );

      expect(storageMocks.uploadFile).not.toHaveBeenCalled();
    });
  });
});
