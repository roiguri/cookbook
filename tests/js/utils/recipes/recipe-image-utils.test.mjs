import { jest } from '@jest/globals';

// Mocks for Firebase/Firestore/Storage
import '../../../common/mocks/firebase-firestore.mock.js';
import '../../../common/mocks/firebase-storage.mock.js';
import '../../../common/mocks/firebase-service.mock.js';

let validateImageFile,
  getImageStoragePath,
  getRecipeImages,
  getPlaceholderImageUrl,
  getPrimaryImage,
  addPendingImages,
  approvePendingImageById,
  rejectPendingImageById,
  getPendingImages;

// Mock StorageService and FirestoreService
const uploadFileMock = jest.fn();
const getFileUrlMock = jest.fn();
const deleteFileMock = jest.fn();
const getDocumentMock = jest.fn();
const updateDocumentMock = jest.fn();

jest.unstable_mockModule('src/js/services/_firebase/storage-service.js', () => ({
  StorageService: {
    uploadFile: uploadFileMock,
    getFileUrl: getFileUrlMock,
    deleteFile: deleteFileMock,
  },
}));
jest.unstable_mockModule('src/js/services/_firebase/firestore-service.js', () => ({
  FirestoreService: {
    getDocument: getDocumentMock,
    updateDocument: updateDocumentMock,
  },
}));

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
    uploadFileMock.mockReset();
    getFileUrlMock.mockReset();
    deleteFileMock.mockReset();
    deleteFileMock.mockImplementation(() => Promise.resolve());
    getDocumentMock.mockReset();
    updateDocumentMock.mockReset();
    const utils = await import('src/js/utils/recipes/recipe-image-utils.js');
    validateImageFile = utils.validateImageFile;
    getImageStoragePath = utils.getImageStoragePath;
    getRecipeImages = utils.getRecipeImages;
    getPlaceholderImageUrl = utils.getPlaceholderImageUrl;
    getPrimaryImage = utils.getPrimaryImage;
    addPendingImages = utils.addPendingImages;
    approvePendingImageById = utils.approvePendingImageById;
    rejectPendingImageById = utils.rejectPendingImageById;
    getPendingImages = utils.getPendingImages;
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

  describe('addPendingImages', () => {
    it('uploads multiple files and appends to pendingImages', async () => {
      uploadFileMock.mockResolvedValue('url');
      updateDocumentMock.mockResolvedValue();
      getDocumentMock.mockResolvedValue({ pendingImages: [] });
      const files = [createFakeFile('a.jpg'), createFakeFile('b.jpg')];
      const result = await addPendingImages('rid', files, 'cat', 'user1');
      expect(uploadFileMock).toHaveBeenCalledTimes(2);
      expect(updateDocumentMock).toHaveBeenCalledWith(
        'recipes',
        'rid',
        expect.objectContaining({ pendingImages: expect.any(Array) }),
      );
      expect(result.length).toBe(2);
      expect(result[0]).toHaveProperty('id');
      expect(result[1]).toHaveProperty('id');
    });
    it('returns [] if no files', async () => {
      getDocumentMock.mockResolvedValue({ pendingImages: [] });
      const result = await addPendingImages('rid', [], 'cat', 'user1');
      expect(result).toEqual([]);
      expect(updateDocumentMock).not.toHaveBeenCalled();
    });
  });

  describe('approvePendingImageById', () => {
    it('moves the correct pending image to images array', async () => {
      const pending = {
        id: 'pid',
        full: 'img/recipes/full/cat/rid/img.jpg',
        fileExtension: 'jpg',
        uploadedBy: 'u',
      };
      getDocumentMock.mockResolvedValue({ pendingImages: [pending], images: [] });
      updateDocumentMock.mockResolvedValue();
      await approvePendingImageById('rid', 'pid');
      expect(updateDocumentMock).toHaveBeenCalledWith(
        'recipes',
        'rid',
        expect.objectContaining({ images: expect.any(Array), pendingImages: [] }),
      );
    });
    it('throws if pending image not found', async () => {
      getDocumentMock.mockResolvedValue({ pendingImages: [{ id: 'other' }] });
      await expect(approvePendingImageById('rid', 'pid')).rejects.toThrow();
    });
    it('throws if no pendingImages', async () => {
      getDocumentMock.mockResolvedValue({});
      await expect(approvePendingImageById('rid', 'pid')).rejects.toThrow();
    });
  });

  describe('rejectPendingImageById', () => {
    it('deletes all files and removes the pending image from the array', async () => {
      const pending = { id: 'pid', full: 'img/recipes/full/cat/rid/image.jpg' };
      getDocumentMock.mockResolvedValue({ pendingImages: [pending, { id: 'other' }] });
      updateDocumentMock.mockResolvedValue();
      await rejectPendingImageById('rid', 'pid');
      expect(deleteFileMock).toHaveBeenCalledWith('img/recipes/full/cat/rid/image.jpg');
      expect(deleteFileMock).toHaveBeenCalledWith('img/recipes/full/cat/rid/image_400x400.webp');
      expect(deleteFileMock).toHaveBeenCalledWith('img/recipes/full/cat/rid/image_1080x1080.webp');
      expect(updateDocumentMock).toHaveBeenCalledWith(
        'recipes',
        'rid',
        expect.objectContaining({ pendingImages: [{ id: 'other' }] }),
      );
    });
    it('throws if pending image not found', async () => {
      getDocumentMock.mockResolvedValue({ pendingImages: [{ id: 'other' }] });
      await expect(rejectPendingImageById('rid', 'pid')).rejects.toThrow();
    });
    it('throws if no pendingImages', async () => {
      getDocumentMock.mockResolvedValue({});
      await expect(rejectPendingImageById('rid', 'pid')).rejects.toThrow();
    });
  });

  describe('getPendingImages', () => {
    it('returns the pendingImages array', async () => {
      getDocumentMock.mockResolvedValue({ pendingImages: [{ id: 'a' }, { id: 'b' }] });
      const result = await getPendingImages('rid');
      expect(result).toEqual([{ id: 'a' }, { id: 'b' }]);
    });
    it('returns [] if no pendingImages', async () => {
      getDocumentMock.mockResolvedValue({});
      const result = await getPendingImages('rid');
      expect(result).toEqual([]);
    });
  });
});
