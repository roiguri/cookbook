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
  // jsdom doesn't ship `fetch`; tests stub a Response-shaped object via this mock.
  global.fetch = jest.fn();
});

beforeEach(async () => {
  jest.resetModules();
  Object.values(storageMocks).forEach((m) => m.mockReset?.());
  storageMocks.deleteFile.mockImplementation(() => Promise.resolve());
  global.fetch.mockReset();

  ({ RecipeImageService } = await import('src/js/services/recipes/recipe-image-service.js'));
});

function makeFile(name = 'a.jpg', type = 'image/jpeg') {
  return new File([new Blob(['a'], { type })], name, { type });
}

describe('RecipeImageService', () => {
  describe('uploadFiles', () => {
    it('uploads to the per-category full path and returns image metadata', async () => {
      storageMocks.uploadFile.mockResolvedValue();
      const file = makeFile('test.jpg');

      const meta = await RecipeImageService.uploadFiles('rid', 'cat', file, 'user-1', true);

      expect(storageMocks.uploadFile).toHaveBeenCalledTimes(1);
      const [uploadedFile, uploadedPath] = storageMocks.uploadFile.mock.calls[0];
      expect(uploadedFile).toBe(file);
      expect(uploadedPath).toBe('img/recipes/full/cat/rid/primary.jpg');
      expect(meta).toMatchObject({
        full: 'img/recipes/full/cat/rid/primary.jpg',
        fileName: 'primary.jpg',
        isPrimary: true,
        uploadedBy: 'user-1',
        access: 'public',
      });
      expect(meta.id).toMatch(/^img-/);
      expect(meta.uploadTimestamp).toBeInstanceOf(Date);
    });

    it('uses a timestamped fileName for non-primary uploads', async () => {
      storageMocks.uploadFile.mockResolvedValue();
      const file = makeFile('photo.png', 'image/png');

      const meta = await RecipeImageService.uploadFiles('rid', 'cat', file, 'user-2');

      expect(meta.isPrimary).toBe(false);
      expect(meta.fileName).toMatch(/\.png$/);
      expect(meta.fileName).not.toBe('primary.jpg');
    });
  });

  describe('deleteFiles', () => {
    it('deletes the full file, both WebP variants, the backup, and its variants', async () => {
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
    });

    it('propagates an error from the full-file delete', async () => {
      storageMocks.deleteFile.mockRejectedValueOnce(new Error('permission denied'));
      await expect(
        RecipeImageService.deleteFiles({ full: 'img/recipes/full/cat/rid/image.jpg' }),
      ).rejects.toThrow('permission denied');
    });

    it('treats variant failures as best-effort', async () => {
      storageMocks.deleteFile
        .mockResolvedValueOnce(undefined) // full
        .mockRejectedValueOnce(new Error('missing')) // 400 variant
        .mockRejectedValueOnce(new Error('missing')) // 1080 variant
        .mockRejectedValueOnce(new Error('missing')) // backup
        .mockRejectedValueOnce(new Error('missing')) // backup 400
        .mockRejectedValueOnce(new Error('missing')); // backup 1080
      await expect(
        RecipeImageService.deleteFiles({ full: 'img/recipes/full/cat/rid/image.jpg' }),
      ).resolves.not.toThrow();
    });
  });

  describe('migrateFilesToCategory', () => {
    it('throws when the image has no `full` path', async () => {
      await expect(
        RecipeImageService.migrateFilesToCategory('rid', { id: 'img-1' }, 'newcat'),
      ).rejects.toThrow('image with `full` path is required');
    });

    it('copies the full file to the new category path and removes the source', async () => {
      const image = { id: 'img-1', full: 'img/recipes/full/oldcat/rid/photo.jpg' };
      storageMocks.getFileUrl.mockResolvedValue('https://storage/photo.jpg');
      const fullBytes = new Blob(['original'], { type: 'image/jpeg' });
      global.fetch
        .mockResolvedValueOnce({ ok: true, blob: async () => fullBytes }) // full fetch
        .mockResolvedValueOnce({ ok: false, status: 404 }); // _original backup fetch — none

      const result = await RecipeImageService.migrateFilesToCategory('rid', image, 'newcat');

      expect(result.full).toBe('img/recipes/full/newcat/rid/photo.jpg');
      // 1st upload = full bytes to new path
      expect(storageMocks.uploadFile).toHaveBeenNthCalledWith(
        1,
        fullBytes,
        'img/recipes/full/newcat/rid/photo.jpg',
      );
      // Source full deleted
      expect(storageMocks.deleteFile).toHaveBeenCalledWith('img/recipes/full/oldcat/rid/photo.jpg');
      // Stale source variants cleaned up
      expect(storageMocks.deleteFile).toHaveBeenCalledWith(
        'img/recipes/full/oldcat/rid/photo_400x400.webp',
      );
      expect(storageMocks.deleteFile).toHaveBeenCalledWith(
        'img/recipes/full/oldcat/rid/photo_1080x1080.webp',
      );
    });

    it('also copies the _original backup when present', async () => {
      const image = { id: 'img-1', full: 'img/recipes/full/oldcat/rid/photo.jpg' };
      storageMocks.getFileUrl.mockResolvedValue('https://storage/url');
      const fullBytes = new Blob(['orig']);
      const backupBytes = new Blob(['backup']);
      global.fetch
        .mockResolvedValueOnce({ ok: true, blob: async () => fullBytes }) // full
        .mockResolvedValueOnce({ ok: true, blob: async () => backupBytes }); // backup present

      await RecipeImageService.migrateFilesToCategory('rid', image, 'newcat');

      // 2nd upload = backup bytes to new backup path
      expect(storageMocks.uploadFile).toHaveBeenNthCalledWith(
        2,
        backupBytes,
        'img/recipes/full/newcat/rid/photo_original.jpg',
      );
      // Source backup is deleted
      expect(storageMocks.deleteFile).toHaveBeenCalledWith(
        'img/recipes/full/oldcat/rid/photo_original.jpg',
      );
    });

    it('wraps and rethrows when the full-file fetch fails', async () => {
      const image = { id: 'img-1', full: 'img/recipes/full/oldcat/rid/photo.jpg' };
      storageMocks.getFileUrl.mockResolvedValue('https://storage/url');
      global.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        RecipeImageService.migrateFilesToCategory('rid', image, 'newcat'),
      ).rejects.toThrow('Failed to migrate image img-1:');

      errSpy.mockRestore();
    });
  });

  describe('replaceFiles', () => {
    const newBlob = new Blob(['enhanced'], { type: 'image/jpeg' });

    function makeImage() {
      return { id: 'img-1', full: 'img/recipes/full/desserts/recipe-9/img-1.jpg' };
    }

    it('throws if image / blob is missing', async () => {
      await expect(RecipeImageService.replaceFiles('r', { id: 'i' }, newBlob)).rejects.toThrow(
        'image with `full` path is required',
      );
      await expect(RecipeImageService.replaceFiles('r', makeImage(), null)).rejects.toThrow(
        'blob is required',
      );
    });

    it('writes the backup when none exists, then overwrites the original', async () => {
      storageMocks.getMetadata.mockRejectedValueOnce(new Error('not-found'));
      storageMocks.getFileUrl.mockResolvedValue('https://storage/original-url');
      const originalBytes = new Blob(['original'], { type: 'image/jpeg' });
      global.fetch.mockResolvedValue({
        ok: true,
        blob: async () => originalBytes,
      });

      const result = await RecipeImageService.replaceFiles('recipe-9', makeImage(), newBlob);

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
      storageMocks.getMetadata.mockResolvedValue({ name: 'backup' });

      const result = await RecipeImageService.replaceFiles('recipe-9', makeImage(), newBlob);

      expect(result.backupCreated).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(storageMocks.uploadFile).toHaveBeenCalledTimes(1);
      expect(storageMocks.uploadFile).toHaveBeenCalledWith(
        newBlob,
        'img/recipes/full/desserts/recipe-9/img-1.jpg',
      );
    });

    it('skips backup entirely when keepOriginalBackup is false', async () => {
      await RecipeImageService.replaceFiles('recipe-9', makeImage(), newBlob, {
        keepOriginalBackup: false,
      });

      expect(storageMocks.getMetadata).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(storageMocks.uploadFile).toHaveBeenCalledTimes(1);
    });

    it('deletes stale 400 and 1080 WebP variants after overwrite (best-effort)', async () => {
      storageMocks.getMetadata.mockResolvedValue({});

      await RecipeImageService.replaceFiles('recipe-9', makeImage(), newBlob);

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

      await expect(
        RecipeImageService.replaceFiles('recipe-9', makeImage(), newBlob),
      ).rejects.toThrow('failed to fetch original (403)');

      // Overwrite never happened
      expect(storageMocks.uploadFile).not.toHaveBeenCalled();
    });
  });
});
