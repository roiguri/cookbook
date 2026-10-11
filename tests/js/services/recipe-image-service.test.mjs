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

    it('uploads into the recipe images folder under a unique name, primary or not', async () => {
      storageMocks.uploadFile.mockResolvedValue();
      const file = makeFile('foo.jpg');

      const meta = await RecipeImageService.uploadFile('r1', file, {
        isPrimary: true,
        uploadedBy: 'user-1',
      });

      expect(storageMocks.uploadFile).toHaveBeenCalledTimes(1);
      const [uploadedFile, uploadedPath] = storageMocks.uploadFile.mock.calls[0];
      expect(uploadedFile).toBe(file);
      // Never `primary.jpg`: uploads don't overwrite; primary is the isPrimary flag.
      expect(uploadedPath).toBe(`recipes/r1/images/${meta.id}.jpg`);
      expect(meta).toMatchObject({
        full: uploadedPath,
        fileName: `${meta.id}.jpg`,
        isPrimary: true,
        uploadedBy: 'user-1',
        access: 'public',
      });
      expect(meta.id).toMatch(/^img-/);
      expect(meta.uploadTimestamp).toBeInstanceOf(Date);
    });

    it('keeps the file extension and gives each upload a different name', async () => {
      storageMocks.uploadFile.mockResolvedValue();
      const a = await RecipeImageService.uploadFile('r2', makeFile('cake.png', 'image/png'));
      const b = await RecipeImageService.uploadFile('r2', makeFile('cake.png', 'image/png'));
      expect(a.fileName).toMatch(/\.png$/);
      expect(a.full).not.toBe(b.full);
      expect(a.isPrimary).toBe(false);
    });

    it('uploads into a given folder (e.g. an edit suggestion)', async () => {
      storageMocks.uploadFile.mockResolvedValue();
      const meta = await RecipeImageService.uploadFile('r1', makeFile('x.jpg'), {
        folder: 'suggestions/s1/images',
      });
      expect(meta.full).toBe(`suggestions/s1/images/${meta.fileName}`);
    });

    it('propagates Storage upload errors', async () => {
      storageMocks.uploadFile.mockRejectedValue(new Error('storage down'));

      await expect(
        RecipeImageService.uploadFile('r3', makeFile(), {
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

  describe('getOptimizedUrl', () => {
    it('returns the WebP variant URL when available', async () => {
      storageMocks.getFileUrl.mockResolvedValueOnce('webp-url');
      const image = { id: '1', full: 'img/recipes/full/cat/rid/image.jpg' };
      const result = await RecipeImageService.getOptimizedUrl(image, '400x400');
      expect(storageMocks.getFileUrl).toHaveBeenCalledWith(
        'img/recipes/full/cat/rid/image_400x400.webp',
      );
      expect(result).toBe('webp-url');
    });

    it('falls back to the full file when the WebP variant is missing', async () => {
      storageMocks.getFileUrl
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValueOnce('full-url');
      const image = { id: '1', full: 'img/recipes/full/cat/rid/image.jpg' };
      const result = await RecipeImageService.getOptimizedUrl(image, '400x400');
      expect(result).toBe('full-url');
    });

    it('returns null when both lookups fail', async () => {
      storageMocks.getFileUrl.mockRejectedValue(new Error('not found'));
      const image = { id: '1', full: 'img/recipes/full/cat/rid/image.jpg' };
      const result = await RecipeImageService.getOptimizedUrl(image, '400x400');
      expect(result).toBeNull();
    });

    it('returns null for null image and never hits Storage', async () => {
      expect(await RecipeImageService.getOptimizedUrl(null, '400x400')).toBeNull();
      expect(storageMocks.getFileUrl).not.toHaveBeenCalled();
    });

    it('returns null for an image without a full path and never hits Storage', async () => {
      expect(await RecipeImageService.getOptimizedUrl({ id: '1' }, '400x400')).toBeNull();
      expect(storageMocks.getFileUrl).not.toHaveBeenCalled();
    });

    it('honors the size suffix in the requested variant path', async () => {
      storageMocks.getFileUrl.mockResolvedValueOnce('webp-1080');
      const image = { id: '1', full: 'img/recipes/full/cat/rid/image.jpg' };
      await RecipeImageService.getOptimizedUrl(image, '1080x1080');
      expect(storageMocks.getFileUrl).toHaveBeenCalledWith(
        'img/recipes/full/cat/rid/image_1080x1080.webp',
      );
    });

    it('returns the local preview URL when present, bypassing Storage', async () => {
      const image = { preview: 'blob:local-preview', full: 'whatever' };
      const result = await RecipeImageService.getOptimizedUrl(image, '400x400');
      expect(result).toBe('blob:local-preview');
      expect(storageMocks.getFileUrl).not.toHaveBeenCalled();
    });
  });

  describe('getPrimaryUrl', () => {
    it('returns the optimized URL of the explicit primary image', async () => {
      storageMocks.getFileUrl.mockResolvedValueOnce('webp-url');
      const recipe = {
        images: [{ id: '1', isPrimary: true, full: 'img/recipes/full/cat/rid/img.jpg' }],
      };
      await expect(RecipeImageService.getPrimaryUrl(recipe)).resolves.toBe('webp-url');
      expect(storageMocks.getFileUrl).toHaveBeenCalledWith(
        'img/recipes/full/cat/rid/img_400x400.webp',
      );
    });

    it('returns the optimized URL of the first image when none is marked primary', async () => {
      storageMocks.getFileUrl.mockResolvedValueOnce('webp-url2');
      const recipe = {
        images: [{ id: '1', full: 'img/recipes/full/cat/rid/img2.jpg' }],
      };
      await expect(RecipeImageService.getPrimaryUrl(recipe)).resolves.toBe('webp-url2');
    });

    it('returns null when the recipe has no images', async () => {
      await expect(RecipeImageService.getPrimaryUrl({ images: [] })).resolves.toBeNull();
      await expect(RecipeImageService.getPrimaryUrl({})).resolves.toBeNull();
      await expect(RecipeImageService.getPrimaryUrl(null)).resolves.toBeNull();
      expect(storageMocks.getFileUrl).not.toHaveBeenCalled();
    });
  });

  describe('getFullUrl', () => {
    it('resolves to StorageService.getFileUrl for image.full', async () => {
      storageMocks.getFileUrl.mockResolvedValueOnce('https://storage/full');
      const result = await RecipeImageService.getFullUrl({
        full: 'img/recipes/full/cat/rid/img.jpg',
      });
      expect(storageMocks.getFileUrl).toHaveBeenCalledWith('img/recipes/full/cat/rid/img.jpg');
      expect(result).toBe('https://storage/full');
    });

    it('throws if image.full is missing', async () => {
      await expect(RecipeImageService.getFullUrl(null)).rejects.toThrow('image.full is required');
      await expect(RecipeImageService.getFullUrl({})).rejects.toThrow('image.full is required');
      await expect(RecipeImageService.getFullUrl({ full: '' })).rejects.toThrow(
        'image.full is required',
      );
    });

    it('propagates Storage errors', async () => {
      storageMocks.getFileUrl.mockRejectedValueOnce(new Error('permission denied'));
      await expect(
        RecipeImageService.getFullUrl({ full: 'img/recipes/full/cat/rid/img.jpg' }),
      ).rejects.toThrow('permission denied');
    });
  });
});
