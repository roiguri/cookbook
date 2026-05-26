import { jest } from '@jest/globals';

let validateMediaFile, validateMediaInstructionData, generateMediaInstructionId;

// Helper: create a fake File
function createFakeFile(name = 'test.jpg', type = 'image/jpeg', size = 1000) {
  const blob = new Blob(['a'.repeat(size)], { type });
  return new File([blob], name, { type });
}

describe('recipe-media-utils', () => {
  beforeAll(async () => {
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');

    if (!globalThis.crypto) globalThis.crypto = {};
    if (!globalThis.crypto.randomUUID) {
      const { randomUUID } = await import('crypto');
      globalThis.crypto.randomUUID = randomUUID;
    }
  });

  beforeEach(async () => {
    jest.resetModules();
    const utils = await import('src/js/utils/recipes/recipe-media-utils.js');
    validateMediaFile = utils.validateMediaFile;
    validateMediaInstructionData = utils.validateMediaInstructionData;
    generateMediaInstructionId = utils.generateMediaInstructionId;
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
});
