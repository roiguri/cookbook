import { jest } from '@jest/globals';

// Mocks for Firebase/Firestore/Storage
import '../../../common/mocks/firebase-firestore.mock.js';
import '../../../common/mocks/firebase-storage.mock.js';
import '../../../common/mocks/firebase-service.mock.js';

let validateMediaFile,
  validateMediaInstructionData,
  generateMediaInstructionId,
  uploadMediaInstructionFile,
  deleteMediaInstructionFile,
  deleteMediaInstructionFiles,
  getMediaInstructionUrl;

// Mock StorageService
const uploadFileMock = jest.fn();
const getFileUrlMock = jest.fn();
const deleteFileMock = jest.fn();

jest.unstable_mockModule('src/js/services/_firebase/storage-service.js', () => ({
  StorageService: {
    uploadFile: uploadFileMock,
    getFileUrl: getFileUrlMock,
    deleteFile: deleteFileMock,
  },
}));

// Helper: create a fake File
function createFakeFile(name = 'test.jpg', type = 'image/jpeg', size = 1000) {
  const blob = new Blob(['a'.repeat(size)], { type });
  return new File([blob], name, { type });
}

describe('recipe-media-utils', () => {
  beforeAll(async () => {
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');

    // Polyfill crypto.randomUUID for Node.js test environment
    if (!globalThis.crypto) {
      globalThis.crypto = {};
    }
    if (!globalThis.crypto.randomUUID) {
      // Use Node.js crypto module for UUID generation in tests
      const { randomUUID } = await import('crypto');
      globalThis.crypto.randomUUID = randomUUID;
    }
  });

  beforeEach(async () => {
    jest.resetModules();
    uploadFileMock.mockReset();
    getFileUrlMock.mockReset();
    deleteFileMock.mockReset();
    deleteFileMock.mockImplementation(() => Promise.resolve());

    const utils = await import('src/js/utils/recipes/recipe-media-utils.js');
    validateMediaFile = utils.validateMediaFile;
    validateMediaInstructionData = utils.validateMediaInstructionData;
    generateMediaInstructionId = utils.generateMediaInstructionId;
    uploadMediaInstructionFile = utils.uploadMediaInstructionFile;
    deleteMediaInstructionFile = utils.deleteMediaInstructionFile;
    deleteMediaInstructionFiles = utils.deleteMediaInstructionFiles;
    getMediaInstructionUrl = utils.getMediaInstructionUrl;
  });

  // --- validateMediaFile ---
  describe('validateMediaFile', () => {
    it('validates correct image file (JPEG)', () => {
      const file = createFakeFile('test.jpg', 'image/jpeg', 1000);
      const result = validateMediaFile(file);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('validates correct image file (PNG)', () => {
      const file = createFakeFile('test.png', 'image/png', 2000);
      const result = validateMediaFile(file);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('validates correct video file (MP4)', () => {
      const file = createFakeFile('test.mp4', 'video/mp4', 10 * 1024 * 1024);
      const result = validateMediaFile(file);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('validates correct video file (WebM)', () => {
      const file = createFakeFile('test.webm', 'video/webm', 5 * 1024 * 1024);
      const result = validateMediaFile(file);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('rejects missing file', () => {
      const result = validateMediaFile(null);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('לא סופק קובץ');
    });

    it('rejects undefined file', () => {
      const result = validateMediaFile(undefined);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('לא סופק קובץ');
    });

    it('rejects wrong type (PDF)', () => {
      const file = createFakeFile('test.pdf', 'application/pdf', 1000);
      const result = validateMediaFile(file);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('סוג קובץ לא תקין');
    });

    it('rejects wrong type (text)', () => {
      const file = createFakeFile('test.txt', 'text/plain', 1000);
      const result = validateMediaFile(file);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('סוג קובץ לא תקין');
    });

    it('rejects file too large (>50MB)', () => {
      const file = createFakeFile('huge.jpg', 'image/jpeg', 51 * 1024 * 1024);
      const result = validateMediaFile(file);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('גדול מדי');
    });

    it('accepts file exactly at 50MB limit', () => {
      const file = createFakeFile('max.jpg', 'image/jpeg', 50 * 1024 * 1024);
      const result = validateMediaFile(file);
      expect(result.isValid).toBe(true);
    });
  });

  // --- validateMediaInstructionData ---
  describe('validateMediaInstructionData', () => {
    it('validates correct media instructions array', () => {
      const validData = [
        {
          id: 'media-123',
          path: 'recipes/test/media-instructions/file.jpg',
          caption: 'שלב ראשון',
          type: 'image',
          order: 0,
          uploadedBy: 'user-123',
          uploadedAt: new Date(),
        },
        {
          id: 'media-456',
          path: 'recipes/test/media-instructions/video.mp4',
          caption: 'שלב שני',
          type: 'video',
          order: 1,
          uploadedBy: 'user-456',
          uploadedAt: new Date(),
        },
      ];
      const result = validateMediaInstructionData(validData);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('validates empty array', () => {
      const result = validateMediaInstructionData([]);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('rejects non-array input (object)', () => {
      const result = validateMediaInstructionData({ foo: 'bar' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('mediaInstructions must be an array');
    });

    it('rejects non-array input (string)', () => {
      const result = validateMediaInstructionData('not an array');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('must be an array');
    });

    it('rejects item missing id field', () => {
      const invalidData = [
        {
          // missing id
          path: 'recipes/test/media-instructions/file.jpg',
          caption: 'שלב',
          type: 'image',
          order: 0,
          uploadedBy: 'user-123',
          uploadedAt: new Date(),
        },
      ];
      const result = validateMediaInstructionData(invalidData);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("'id'"))).toBe(true);
    });

    it('rejects item missing path field', () => {
      const invalidData = [
        {
          id: 'media-123',
          // missing path
          caption: 'שלב',
          type: 'image',
          order: 0,
          uploadedBy: 'user-123',
          uploadedAt: new Date(),
        },
      ];
      const result = validateMediaInstructionData(invalidData);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("'path'"))).toBe(true);
    });

    it('rejects item with invalid type field', () => {
      const invalidData = [
        {
          id: 'media-123',
          path: 'recipes/test/media-instructions/file.jpg',
          caption: 'שלב',
          type: 'audio', // Invalid type
          order: 0,
          uploadedBy: 'user-123',
          uploadedAt: new Date(),
        },
      ];
      const result = validateMediaInstructionData(invalidData);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("'type'"))).toBe(true);
    });

    it('rejects item with negative order', () => {
      const invalidData = [
        {
          id: 'media-123',
          path: 'recipes/test/media-instructions/file.jpg',
          caption: 'שלב',
          type: 'image',
          order: -1, // Negative order
          uploadedBy: 'user-123',
          uploadedAt: new Date(),
        },
      ];
      const result = validateMediaInstructionData(invalidData);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("'order'"))).toBe(true);
    });

    it('reports multiple errors for single item', () => {
      const invalidData = [
        {
          // missing id, path, caption
          type: 'invalid-type',
          order: -5,
          uploadedBy: 123, // wrong type (should be string)
        },
      ];
      const result = validateMediaInstructionData(invalidData);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(3);
    });

    it('allows empty caption string', () => {
      const validData = [
        {
          id: 'media-123',
          path: 'recipes/test/media-instructions/file.jpg',
          caption: '', // Empty caption should be valid
          type: 'image',
          order: 0,
          uploadedBy: 'user-123',
          uploadedAt: new Date(),
        },
      ];
      const result = validateMediaInstructionData(validData);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('rejects non-string caption', () => {
      const invalidData = [
        {
          id: 'media-123',
          path: 'recipes/test/media-instructions/file.jpg',
          caption: null, // null is not a valid caption (must be string)
          type: 'image',
          order: 0,
          uploadedBy: 'user-123',
          uploadedAt: new Date(),
        },
      ];
      const result = validateMediaInstructionData(invalidData);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("'caption'"))).toBe(true);
    });
  });

  // --- generateMediaInstructionId ---
  describe('generateMediaInstructionId', () => {
    it('generates ID with correct prefix', () => {
      const id = generateMediaInstructionId();
      expect(id).toMatch(/^media-/);
    });

    it('generates unique IDs', () => {
      const id1 = generateMediaInstructionId();
      const id2 = generateMediaInstructionId();
      expect(id1).not.toBe(id2);
    });

    it('generates IDs with correct UUID format', () => {
      const id = generateMediaInstructionId();
      // Format: media-{UUID} (RFC 4122 compliant)
      // UUID format: 8-4-4-4-12 hexadecimal characters
      expect(id).toMatch(/^media-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });

  // --- uploadMediaInstructionFile ---
  describe('uploadMediaInstructionFile', () => {
    it('uploads valid image file successfully', async () => {
      uploadFileMock.mockResolvedValue('https://firebase.storage/url');

      const file = createFakeFile('test.jpg', 'image/jpeg', 1000);
      const result = await uploadMediaInstructionFile(file, 'recipe-123', 'user-456');

      expect(uploadFileMock).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        id: expect.stringMatching(/^media-/),
        path: expect.stringContaining('recipes/recipe-123/media-instructions/'),
        caption: '',
        type: 'image',
        order: 0,
        uploadedBy: 'user-456',
      });
      expect(result.uploadedAt).toBeDefined();
    });

    it('uploads valid video file successfully', async () => {
      uploadFileMock.mockResolvedValue('https://firebase.storage/url');

      const file = createFakeFile('test.mp4', 'video/mp4', 5 * 1024 * 1024);
      const result = await uploadMediaInstructionFile(file, 'recipe-789', 'user-111');

      expect(uploadFileMock).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        type: 'video',
        uploadedBy: 'user-111',
      });
      expect(result.path).toContain('recipes/recipe-789/media-instructions/');
    });

    it('rejects invalid file type', async () => {
      const file = createFakeFile('test.pdf', 'application/pdf', 1000);

      await expect(uploadMediaInstructionFile(file, 'recipe-123', 'user-456')).rejects.toThrow(
        'בדיקת הקובץ נכשלה',
      );

      expect(uploadFileMock).not.toHaveBeenCalled();
    });

    it('rejects file too large', async () => {
      const file = createFakeFile('huge.jpg', 'image/jpeg', 51 * 1024 * 1024);

      await expect(uploadMediaInstructionFile(file, 'recipe-123', 'user-456')).rejects.toThrow(
        'בדיקת הקובץ נכשלה',
      );

      expect(uploadFileMock).not.toHaveBeenCalled();
    });

    it('rejects invalid recipeId', async () => {
      const file = createFakeFile('test.jpg', 'image/jpeg', 1000);

      await expect(uploadMediaInstructionFile(file, null, 'user-456')).rejects.toThrow(
        'Invalid recipeId',
      );

      expect(uploadFileMock).not.toHaveBeenCalled();
    });

    it('rejects invalid userId', async () => {
      const file = createFakeFile('test.jpg', 'image/jpeg', 1000);

      await expect(uploadMediaInstructionFile(file, 'recipe-123', null)).rejects.toThrow(
        'Invalid userId',
      );

      expect(uploadFileMock).not.toHaveBeenCalled();
    });

    it('handles upload failure', async () => {
      uploadFileMock.mockRejectedValue(new Error('Storage error'));
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const file = createFakeFile('test.jpg', 'image/jpeg', 1000);

      await expect(uploadMediaInstructionFile(file, 'recipe-123', 'user-456')).rejects.toThrow(
        'העלאת הקובץ נכשלה',
      );

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('sanitizes file names with special characters', async () => {
      uploadFileMock.mockResolvedValue('https://firebase.storage/url');

      const file = createFakeFile('test file@#$.jpg', 'image/jpeg', 1000);
      const result = await uploadMediaInstructionFile(file, 'recipe-123', 'user-456');

      // Path should contain sanitized filename (spaces and special chars become underscores)
      expect(result.path).toMatch(/test_file___\.jpg$/);
    });

    it('calls progress callback if provided', async () => {
      uploadFileMock.mockResolvedValue('https://firebase.storage/url');
      const onProgress = jest.fn();

      const file = createFakeFile('test.jpg', 'image/jpeg', 1000);
      await uploadMediaInstructionFile(file, 'recipe-123', 'user-456', onProgress);

      expect(onProgress).toHaveBeenCalledWith(0);
      expect(onProgress).toHaveBeenCalledWith(100);
    });
  });

  // --- deleteMediaInstructionFile ---
  describe('deleteMediaInstructionFile', () => {
    it('deletes file successfully', async () => {
      deleteFileMock.mockResolvedValue();

      await deleteMediaInstructionFile('recipes/test/media-instructions/file.jpg');

      expect(deleteFileMock).toHaveBeenCalledWith('recipes/test/media-instructions/file.jpg');
    });

    it('rejects invalid filePath (null)', async () => {
      await expect(deleteMediaInstructionFile(null)).rejects.toThrow('Invalid filePath');

      expect(deleteFileMock).not.toHaveBeenCalled();
    });

    it('rejects invalid filePath (empty string)', async () => {
      await expect(deleteMediaInstructionFile('')).rejects.toThrow('Invalid filePath');

      expect(deleteFileMock).not.toHaveBeenCalled();
    });

    it('handles file not found gracefully', async () => {
      const notFoundError = new Error('File not found');
      notFoundError.code = 'storage/object-not-found';
      deleteFileMock.mockRejectedValue(notFoundError);

      // Should NOT throw
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      await expect(
        deleteMediaInstructionFile('recipes/test/media-instructions/missing.jpg'),
      ).resolves.toBeUndefined();
      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it('throws error for other storage errors', async () => {
      deleteFileMock.mockRejectedValue(new Error('Permission denied'));
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        deleteMediaInstructionFile('recipes/test/media-instructions/file.jpg'),
      ).rejects.toThrow('מחיקת הקובץ נכשלה');

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  // --- deleteMediaInstructionFiles (batch) ---
  describe('deleteMediaInstructionFiles', () => {
    it('deletes multiple files successfully', async () => {
      deleteFileMock.mockResolvedValue();

      const paths = ['path1.jpg', 'path2.mp4', 'path3.jpg'];
      const result = await deleteMediaInstructionFiles(paths);

      expect(deleteFileMock).toHaveBeenCalledTimes(3);
      expect(result.success).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.errors).toEqual([]);
    });

    it('handles partial failures', async () => {
      deleteFileMock
        .mockResolvedValueOnce() // success
        .mockRejectedValueOnce(new Error('Failed')) // fail
        .mockResolvedValueOnce(); // success

      const paths = ['path1.jpg', 'path2.mp4', 'path3.jpg'];
      const result = await deleteMediaInstructionFiles(paths);

      expect(result.success).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].path).toBe('path2.mp4');
    });

    it('handles empty array', async () => {
      const result = await deleteMediaInstructionFiles([]);

      expect(deleteFileMock).not.toHaveBeenCalled();
      expect(result.success).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('rejects non-array input', async () => {
      await expect(deleteMediaInstructionFiles('not-an-array')).rejects.toThrow(
        'filePaths must be an array',
      );
    });
  });

  // --- getMediaInstructionUrl ---
  describe('getMediaInstructionUrl', () => {
    it('gets download URL successfully', async () => {
      getFileUrlMock.mockResolvedValue('https://firebase.storage/download-url');

      const url = await getMediaInstructionUrl('recipes/test/media-instructions/file.jpg');

      expect(getFileUrlMock).toHaveBeenCalledWith('recipes/test/media-instructions/file.jpg');
      expect(url).toBe('https://firebase.storage/download-url');
    });

    it('handles error getting URL', async () => {
      getFileUrlMock.mockRejectedValue(new Error('File not found'));
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        getMediaInstructionUrl('recipes/test/media-instructions/missing.jpg'),
      ).rejects.toThrow('קבלת כתובת המדיה נכשלה');

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });
});
