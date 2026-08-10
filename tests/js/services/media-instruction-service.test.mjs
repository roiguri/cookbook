import { jest } from '@jest/globals';

import '../../common/mocks/firebase-firestore.mock.js';
import '../../common/mocks/firebase-storage.mock.js';
import '../../common/mocks/firebase-service.mock.js';

let MediaInstructionService;

const storageMocks = {
  uploadFile: jest.fn(),
  getFileUrl: jest.fn(),
  deleteFile: jest.fn(() => Promise.resolve()),
};

jest.unstable_mockModule('src/js/services/_firebase/storage-service.js', () => ({
  StorageService: storageMocks,
}));

function makeFile(name = 'test.jpg', type = 'image/jpeg', size = 1000) {
  const blob = new Blob(['a'.repeat(size)], { type });
  return new File([blob], name, { type });
}

beforeAll(async () => {
  if (!globalThis.crypto) globalThis.crypto = {};
  if (!globalThis.crypto.randomUUID) {
    const { randomUUID } = await import('crypto');
    globalThis.crypto.randomUUID = randomUUID;
  }
});

beforeEach(async () => {
  jest.resetModules();
  Object.values(storageMocks).forEach((m) => m.mockReset?.());
  storageMocks.deleteFile.mockImplementation(() => Promise.resolve());
  ({ MediaInstructionService } =
    await import('src/js/services/recipes/media-instruction-service.js'));
});

describe('MediaInstructionService', () => {
  describe('upload', () => {
    it('uploads valid image file and returns typed metadata', async () => {
      storageMocks.uploadFile.mockResolvedValue();
      const file = makeFile('test.jpg', 'image/jpeg', 1000);

      const result = await MediaInstructionService.upload(file, 'recipe-123', 'user-456');

      expect(storageMocks.uploadFile).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        id: expect.stringMatching(/^media-/),
        path: expect.stringContaining('recipes/recipe-123/media-instructions/'),
        caption: '',
        type: 'image',
        order: 0,
        uploadedBy: 'user-456',
      });
      expect(result.uploadedAt).toBeInstanceOf(Date);
    });

    it('uploads valid video file', async () => {
      storageMocks.uploadFile.mockResolvedValue();
      const file = makeFile('clip.mp4', 'video/mp4', 5 * 1024 * 1024);

      const result = await MediaInstructionService.upload(file, 'recipe-789', 'user-111');

      expect(result.type).toBe('video');
      expect(result.path).toContain('recipes/recipe-789/media-instructions/');
    });

    it('rejects invalid file type without uploading', async () => {
      const file = makeFile('doc.pdf', 'application/pdf', 1000);
      await expect(MediaInstructionService.upload(file, 'recipe-123', 'user-456')).rejects.toThrow(
        'בדיקת הקובץ נכשלה',
      );
      expect(storageMocks.uploadFile).not.toHaveBeenCalled();
    });

    it('rejects file over 50MB without uploading', async () => {
      const file = makeFile('huge.jpg', 'image/jpeg', 51 * 1024 * 1024);
      await expect(MediaInstructionService.upload(file, 'recipe-123', 'user-456')).rejects.toThrow(
        'בדיקת הקובץ נכשלה',
      );
      expect(storageMocks.uploadFile).not.toHaveBeenCalled();
    });

    it('throws Invalid recipeId for null/empty', async () => {
      const file = makeFile();
      await expect(MediaInstructionService.upload(file, null, 'u1')).rejects.toThrow(
        'Invalid recipeId',
      );
      await expect(MediaInstructionService.upload(file, '', 'u1')).rejects.toThrow(
        'Invalid recipeId',
      );
    });

    it('throws Invalid userId for null/empty', async () => {
      const file = makeFile();
      await expect(MediaInstructionService.upload(file, 'r1', null)).rejects.toThrow(
        'Invalid userId',
      );
    });

    it('wraps Storage upload errors with the Hebrew message', async () => {
      storageMocks.uploadFile.mockRejectedValue(new Error('Storage error'));
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const file = makeFile();
      await expect(MediaInstructionService.upload(file, 'recipe-123', 'user-456')).rejects.toThrow(
        'העלאת הקובץ נכשלה',
      );
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it('sanitizes special characters in the filename portion of the storage path', async () => {
      storageMocks.uploadFile.mockResolvedValue();
      const file = makeFile('test file@#$.jpg', 'image/jpeg', 1000);
      const result = await MediaInstructionService.upload(file, 'recipe-123', 'user-456');
      expect(result.path).toMatch(/test_file___\.jpg$/);
    });

    it('invokes onProgress callback at start and end if provided', async () => {
      storageMocks.uploadFile.mockResolvedValue();
      const onProgress = jest.fn();
      const file = makeFile();
      await MediaInstructionService.upload(file, 'recipe-123', 'user-456', onProgress);
      expect(onProgress).toHaveBeenCalledWith(0);
      expect(onProgress).toHaveBeenCalledWith(100);
    });
  });

  describe('delete', () => {
    it('deletes the file at the given path', async () => {
      await MediaInstructionService.delete('recipes/test/media-instructions/file.jpg');
      expect(storageMocks.deleteFile).toHaveBeenCalledWith(
        'recipes/test/media-instructions/file.jpg',
      );
    });

    it('throws Invalid filePath for null/empty', async () => {
      await expect(MediaInstructionService.delete(null)).rejects.toThrow('Invalid filePath');
      await expect(MediaInstructionService.delete('')).rejects.toThrow('Invalid filePath');
      expect(storageMocks.deleteFile).not.toHaveBeenCalled();
    });

    it('treats storage/object-not-found as success (already gone)', async () => {
      const notFound = new Error('File not found');
      notFound.code = 'storage/object-not-found';
      storageMocks.deleteFile.mockRejectedValueOnce(notFound);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(
        MediaInstructionService.delete('recipes/test/media-instructions/missing.jpg'),
      ).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('wraps other Storage errors with the Hebrew message', async () => {
      storageMocks.deleteFile.mockRejectedValueOnce(new Error('Permission denied'));
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await expect(
        MediaInstructionService.delete('recipes/test/media-instructions/file.jpg'),
      ).rejects.toThrow('מחיקת הקובץ נכשלה');
      errSpy.mockRestore();
    });
  });

  describe('deleteMany', () => {
    it('deletes each path and counts successes', async () => {
      const result = await MediaInstructionService.deleteMany(['p1.jpg', 'p2.mp4', 'p3.jpg']);
      expect(storageMocks.deleteFile).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ success: 3, failed: 0, errors: [] });
    });

    it('collects per-path errors on partial failure', async () => {
      storageMocks.deleteFile
        .mockResolvedValueOnce()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce();

      const result = await MediaInstructionService.deleteMany(['p1', 'p2', 'p3']);

      expect(result.success).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].path).toBe('p2');
    });

    it('returns the empty-success summary for an empty array', async () => {
      const result = await MediaInstructionService.deleteMany([]);
      expect(storageMocks.deleteFile).not.toHaveBeenCalled();
      expect(result).toEqual({ success: 0, failed: 0, errors: [] });
    });

    it('throws if input is not an array', async () => {
      await expect(MediaInstructionService.deleteMany('nope')).rejects.toThrow(
        'filePaths must be an array',
      );
    });
  });

  describe('removeAll', () => {
    it('extracts paths and delegates to deleteMany', async () => {
      const result = await MediaInstructionService.removeAll([
        { path: 'a.jpg' },
        { path: 'b.jpg' },
      ]);
      expect(storageMocks.deleteFile).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(2);
    });

    it('returns empty-success for empty / null without touching Storage', async () => {
      await expect(MediaInstructionService.removeAll([])).resolves.toEqual({
        success: 0,
        failed: 0,
        errors: [],
      });
      await expect(MediaInstructionService.removeAll(null)).resolves.toEqual({
        success: 0,
        failed: 0,
        errors: [],
      });
      expect(storageMocks.deleteFile).not.toHaveBeenCalled();
    });
  });

  describe('getUrl', () => {
    it('returns the download URL from Storage', async () => {
      storageMocks.getFileUrl.mockResolvedValueOnce('https://firebase/url');
      const url = await MediaInstructionService.getUrl('recipes/test/media-instructions/file.jpg');
      expect(storageMocks.getFileUrl).toHaveBeenCalledWith(
        'recipes/test/media-instructions/file.jpg',
      );
      expect(url).toBe('https://firebase/url');
    });

    it('returns empty string for falsy input without touching Storage', async () => {
      expect(await MediaInstructionService.getUrl('')).toBe('');
      expect(await MediaInstructionService.getUrl(null)).toBe('');
      expect(storageMocks.getFileUrl).not.toHaveBeenCalled();
    });

    it('passes through blob: and data: URLs unchanged', async () => {
      expect(await MediaInstructionService.getUrl('blob:something')).toBe('blob:something');
      expect(await MediaInstructionService.getUrl('data:image/png;base64,xx')).toBe(
        'data:image/png;base64,xx',
      );
      expect(storageMocks.getFileUrl).not.toHaveBeenCalled();
    });

    it('wraps Storage errors with the Hebrew message', async () => {
      storageMocks.getFileUrl.mockRejectedValueOnce(new Error('not found'));
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await expect(
        MediaInstructionService.getUrl('recipes/test/media-instructions/missing.jpg'),
      ).rejects.toThrow('קבלת כתובת המדיה נכשלה');
      errSpy.mockRestore();
    });
  });
});
