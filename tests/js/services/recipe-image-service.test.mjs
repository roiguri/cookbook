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
  describe('uploadFile', () => {
    function makeFile(name = 'test.jpg', type = 'image/jpeg') {
      return new File([new Blob(['a'], { type })], name, { type });
    }

    it('uploads to category path and returns metadata with primary.jpg filename when isPrimary', async () => {
      storageMocks.uploadFile.mockResolvedValue();
      const file = makeFile('foo.jpg');

      const meta = await RecipeImageService.uploadFile('r1', 'desserts', file, {
        isPrimary: true,
        uploadedBy: 'user-1',
      });

      expect(storageMocks.uploadFile).toHaveBeenCalledTimes(1);
      const [uploadedFile, uploadedPath] = storageMocks.uploadFile.mock.calls[0];
      expect(uploadedFile).toBe(file);
      expect(uploadedPath).toBe('img/recipes/full/desserts/r1/primary.jpg');

      expect(meta).toMatchObject({
        full: 'img/recipes/full/desserts/r1/primary.jpg',
        fileName: 'primary.jpg',
        isPrimary: true,
        uploadedBy: 'user-1',
        access: 'public',
      });
      expect(typeof meta.id).toBe('string');
      expect(meta.uploadTimestamp).toBeInstanceOf(Date);
    });

    it('uses a timestamped filename keeping the extension when not primary', async () => {
      storageMocks.uploadFile.mockResolvedValue();
      const file = makeFile('cake.png', 'image/png');

      const meta = await RecipeImageService.uploadFile('r2', 'mains', file, {
        isPrimary: false,
        uploadedBy: 'user-2',
      });

      expect(meta.fileName).toMatch(/^\d+\.png$/);
      expect(meta.full).toBe(`img/recipes/full/mains/r2/${meta.fileName}`);
      expect(meta.isPrimary).toBe(false);
    });

    it('propagates Storage upload errors', async () => {
      storageMocks.uploadFile.mockRejectedValue(new Error('storage down'));

      await expect(
        RecipeImageService.uploadFile('r3', 'sides', makeFile(), {
          isPrimary: true,
          uploadedBy: 'user-3',
        }),
      ).rejects.toThrow('storage down');
    });
  });

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

  describe('deleteFiles', () => {
    it('throws if image.full is missing', async () => {
      await expect(RecipeImageService.deleteFiles(null)).rejects.toThrow('image.full is required');
      await expect(RecipeImageService.deleteFiles({})).rejects.toThrow('image.full is required');
    });

    it('deletes the full file, its WebP variants, and the _original backup with its variants', async () => {
      await RecipeImageService.deleteFiles({ full: 'img/recipes/full/cat/rid/image.jpg' });

      expect(storageMocks.deleteFile).toHaveBeenCalledWith('img/recipes/full/cat/rid/image.jpg');
      expect(storageMocks.deleteFile).toHaveBeenCalledWith(
        'img/recipes/full/cat/rid/image_400x400.webp',
      );
      expect(storageMocks.deleteFile).toHaveBeenCalledWith(
        'img/recipes/full/cat/rid/image_1080x1080.webp',
      );
      expect(storageMocks.deleteFile).toHaveBeenCalledWith(
        'img/recipes/full/cat/rid/image_original.jpg',
      );
      expect(storageMocks.deleteFile).toHaveBeenCalledWith(
        'img/recipes/full/cat/rid/image_original_400x400.webp',
      );
      expect(storageMocks.deleteFile).toHaveBeenCalledWith(
        'img/recipes/full/cat/rid/image_original_1080x1080.webp',
      );
    });

    it('silently ignores errors on variant/backup deletion (best-effort)', async () => {
      storageMocks.deleteFile
        .mockResolvedValueOnce(undefined) // full OK
        .mockRejectedValueOnce(new Error('not found'))
        .mockRejectedValueOnce(new Error('not found'))
        .mockRejectedValueOnce(new Error('not found'))
        .mockRejectedValueOnce(new Error('not found'))
        .mockRejectedValueOnce(new Error('not found'));

      await expect(
        RecipeImageService.deleteFiles({ full: 'img/recipes/full/cat/rid/image.jpg' }),
      ).resolves.toBeUndefined();
    });

    it('propagates errors from full file deletion', async () => {
      storageMocks.deleteFile.mockRejectedValueOnce(new Error('permission denied'));

      await expect(
        RecipeImageService.deleteFiles({ full: 'img/recipes/full/cat/rid/image.jpg' }),
      ).rejects.toThrow('permission denied');
    });
  });

  describe('migrateFilesToCategory', () => {
    const image = {
      id: 'img-1',
      full: 'img/recipes/full/desserts/recipe-9/keep.jpg',
      isPrimary: false,
    };

    it('throws if image.full is missing', async () => {
      await expect(
        RecipeImageService.migrateFilesToCategory('recipe-9', null, 'mains'),
      ).rejects.toThrow('image.full is required');
      await expect(
        RecipeImageService.migrateFilesToCategory('recipe-9', {}, 'mains'),
      ).rejects.toThrow('image.full is required');
    });

    it('copies the full bytes to the new path, deletes the old, returns image with updated full', async () => {
      const fullBytes = new Blob(['full'], { type: 'image/jpeg' });
      // 1st getFileUrl = full; 2nd = _original lookup (will throw -> no backup)
      storageMocks.getFileUrl.mockResolvedValueOnce('https://storage/full');
      storageMocks.getFileUrl.mockRejectedValueOnce(new Error('no _original'));
      global.fetch.mockResolvedValueOnce({ ok: true, blob: async () => fullBytes });

      const result = await RecipeImageService.migrateFilesToCategory('recipe-9', image, 'mains');

      expect(storageMocks.uploadFile).toHaveBeenCalledWith(
        fullBytes,
        'img/recipes/full/mains/recipe-9/keep.jpg',
      );
      expect(storageMocks.deleteFile).toHaveBeenCalledWith(
        'img/recipes/full/desserts/recipe-9/keep.jpg',
      );
      expect(result).toEqual({
        ...image,
        full: 'img/recipes/full/mains/recipe-9/keep.jpg',
      });
    });

    it('best-effort deletes old WebP variants at the source path', async () => {
      storageMocks.getFileUrl.mockResolvedValueOnce('https://storage/full');
      storageMocks.getFileUrl.mockRejectedValueOnce(new Error('no _original'));
      global.fetch.mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(['full']),
      });

      await RecipeImageService.migrateFilesToCategory('recipe-9', image, 'mains');

      expect(storageMocks.deleteFile).toHaveBeenCalledWith(
        'img/recipes/full/desserts/recipe-9/keep_400x400.webp',
      );
      expect(storageMocks.deleteFile).toHaveBeenCalledWith(
        'img/recipes/full/desserts/recipe-9/keep_1080x1080.webp',
      );
    });

    it('copies the _original backup to the new path when it exists', async () => {
      const fullBytes = new Blob(['full'], { type: 'image/jpeg' });
      const originalBytes = new Blob(['original'], { type: 'image/jpeg' });
      storageMocks.getFileUrl.mockResolvedValueOnce('https://storage/full');
      storageMocks.getFileUrl.mockResolvedValueOnce('https://storage/original');
      global.fetch
        .mockResolvedValueOnce({ ok: true, blob: async () => fullBytes })
        .mockResolvedValueOnce({ ok: true, blob: async () => originalBytes });

      await RecipeImageService.migrateFilesToCategory('recipe-9', image, 'mains');

      expect(storageMocks.uploadFile).toHaveBeenCalledWith(
        originalBytes,
        'img/recipes/full/mains/recipe-9/keep_original.jpg',
      );
      expect(storageMocks.deleteFile).toHaveBeenCalledWith(
        'img/recipes/full/desserts/recipe-9/keep_original.jpg',
      );
    });

    it('skips the _original copy when the backup is missing (catch and continue)', async () => {
      storageMocks.getFileUrl.mockResolvedValueOnce('https://storage/full');
      storageMocks.getFileUrl.mockRejectedValueOnce(new Error('not-found'));
      global.fetch.mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(['full']),
      });

      await expect(
        RecipeImageService.migrateFilesToCategory('recipe-9', image, 'mains'),
      ).resolves.toMatchObject({ full: 'img/recipes/full/mains/recipe-9/keep.jpg' });
    });

    it('throws a wrapped error mentioning the image id when the full fetch fails', async () => {
      storageMocks.getFileUrl.mockResolvedValueOnce('https://storage/full');
      global.fetch.mockResolvedValueOnce({ ok: false, status: 500 });

      await expect(
        RecipeImageService.migrateFilesToCategory('recipe-9', image, 'mains'),
      ).rejects.toThrow(/Failed to migrate image img-1/);
    });
  });
});
