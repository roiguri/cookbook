import { jest } from '@jest/globals';

// Mocks for the underlying Firebase modules
import '../../common/mocks/firebase-firestore.mock.js';
import '../../common/mocks/firebase-storage.mock.js';
import '../../common/mocks/firebase-service.mock.js';

let RecipeService;

const firestoreMocks = {
  getDocument: jest.fn(),
  setDocument: jest.fn(),
  updateDocument: jest.fn(),
  deleteDocument: jest.fn(),
  queryDocuments: jest.fn(),
  generateId: jest.fn(() => 'recipe-123'),
};

const mediaUtilMocks = {
  uploadMediaInstructionFile: jest.fn(),
  removeAllMediaInstructions: jest.fn(() => Promise.resolve({ success: 0, failed: 0, errors: [] })),
};

const recipeImageServiceMocks = {
  uploadFile: jest.fn(),
  replaceFiles: jest.fn(() =>
    Promise.resolve({ backupPath: 'backup/path.jpg', backupCreated: true }),
  ),
  deleteFiles: jest.fn(() => Promise.resolve()),
  migrateFilesToCategory: jest.fn(),
};

jest.unstable_mockModule('src/js/services/_firebase/firestore-service.js', () => ({
  FirestoreService: firestoreMocks,
}));
jest.unstable_mockModule('src/js/services/recipes/recipe-image-service.js', () => ({
  RecipeImageService: recipeImageServiceMocks,
}));
jest.unstable_mockModule('src/js/utils/recipes/recipe-media-utils.js', () => mediaUtilMocks);

function makeFile(name = 'a.jpg', type = 'image/jpeg') {
  return new File([new Blob(['a'], { type })], name, { type });
}

beforeEach(async () => {
  jest.resetModules();
  Object.values(firestoreMocks).forEach((m) => m.mockReset?.());
  firestoreMocks.generateId.mockImplementation(() => 'recipe-123');
  Object.values(mediaUtilMocks).forEach((m) => m.mockReset?.());
  mediaUtilMocks.removeAllMediaInstructions.mockImplementation(() =>
    Promise.resolve({ success: 0, failed: 0, errors: [] }),
  );
  Object.values(recipeImageServiceMocks).forEach((m) => m.mockReset?.());
  recipeImageServiceMocks.replaceFiles.mockImplementation(() =>
    Promise.resolve({ backupPath: 'backup/path.jpg', backupCreated: true }),
  );
  recipeImageServiceMocks.deleteFiles.mockImplementation(() => Promise.resolve());

  ({ RecipeService } = await import('src/js/services/recipes/recipe-service.js'));
});

describe('RecipeService', () => {
  describe('get / list / generateId', () => {
    it('get delegates to FirestoreService.getDocument', async () => {
      firestoreMocks.getDocument.mockResolvedValue({ id: 'r1', name: 'Bread' });
      const result = await RecipeService.get('r1');
      expect(firestoreMocks.getDocument).toHaveBeenCalledWith('recipes', 'r1');
      expect(result).toEqual({ id: 'r1', name: 'Bread' });
    });

    it('list delegates to FirestoreService.queryDocuments', async () => {
      firestoreMocks.queryDocuments.mockResolvedValue([{ id: 'a' }]);
      const result = await RecipeService.list({ limit: 5 });
      expect(firestoreMocks.queryDocuments).toHaveBeenCalledWith('recipes', { limit: 5 });
      expect(result).toEqual([{ id: 'a' }]);
    });

    it('generateId calls FirestoreService.generateId for recipes', () => {
      expect(RecipeService.generateId()).toBe('recipe-123');
      expect(firestoreMocks.generateId).toHaveBeenCalledWith('recipes');
    });
  });

  describe('create', () => {
    it('uploads images, writes doc, returns id and media result', async () => {
      recipeImageServiceMocks.uploadFile
        .mockResolvedValueOnce({ id: 'img-1', full: 'p/1.jpg' })
        .mockResolvedValueOnce({ id: 'img-2', full: 'p/2.jpg' });
      firestoreMocks.setDocument.mockResolvedValue();

      const result = await RecipeService.create({
        recipeData: { name: 'Cake', category: 'desserts' },
        imagesToUpload: [
          { file: makeFile('1.jpg'), isPrimary: true },
          { file: makeFile('2.jpg'), isPrimary: false },
        ],
        mediaItemsOrdered: [],
        uploadedBy: 'user-1',
      });

      expect(result.recipeId).toBe('recipe-123');
      expect(result.mediaUploadResults).toEqual({
        uploaded: [],
        failed: [],
        totalPending: 0,
        successCount: 0,
        failedCount: 0,
      });
      expect(recipeImageServiceMocks.uploadFile).toHaveBeenCalledTimes(2);
      expect(firestoreMocks.setDocument).toHaveBeenCalledWith(
        'recipes',
        'recipe-123',
        expect.objectContaining({
          name: 'Cake',
          category: 'desserts',
          allowImageSuggestions: true,
          images: [
            { id: 'img-1', full: 'p/1.jpg' },
            { id: 'img-2', full: 'p/2.jpg' },
          ],
        }),
      );
    });

    it('skips images and allowImageSuggestions when there are none', async () => {
      firestoreMocks.setDocument.mockResolvedValue();
      await RecipeService.create({
        recipeData: { name: 'Plain', category: 'mains' },
        uploadedBy: 'user-1',
      });
      const payload = firestoreMocks.setDocument.mock.calls[0][2];
      expect(payload).not.toHaveProperty('images');
      expect(payload).not.toHaveProperty('allowImageSuggestions');
    });

    it('cleans up uploaded images if a later image fails', async () => {
      recipeImageServiceMocks.uploadFile
        .mockResolvedValueOnce({ id: 'img-1', full: 'p/1.jpg' })
        .mockRejectedValueOnce(new Error('upload failed'));

      await expect(
        RecipeService.create({
          recipeData: { name: 'Cake', category: 'desserts' },
          imagesToUpload: [
            { file: makeFile('1.jpg'), isPrimary: true },
            { file: makeFile('2.jpg'), isPrimary: false },
          ],
          uploadedBy: 'user-1',
        }),
      ).rejects.toThrow('upload failed');

      expect(recipeImageServiceMocks.deleteFiles).toHaveBeenCalledWith({
        id: 'img-1',
        full: 'p/1.jpg',
      });
      expect(firestoreMocks.setDocument).not.toHaveBeenCalled();
    });

    it('uploads pending media and assembles sequential order', async () => {
      mediaUtilMocks.uploadMediaInstructionFile
        .mockResolvedValueOnce({ id: 'm-1', path: 'mp/1', order: 0 })
        .mockResolvedValueOnce({ id: 'm-2', path: 'mp/2', order: 0 });
      firestoreMocks.setDocument.mockResolvedValue();

      const result = await RecipeService.create({
        recipeData: { name: 'Cake', category: 'desserts' },
        mediaItemsOrdered: [
          { file: makeFile('m1.jpg'), caption: 'cap1' },
          { id: 'existing-1', path: 'mp/existing', caption: 'cap-existing' },
          { file: makeFile('m2.jpg'), caption: 'cap2' },
        ],
        uploadedBy: 'user-1',
      });

      const payload = firestoreMocks.setDocument.mock.calls[0][2];
      expect(payload.mediaInstructions).toEqual([
        expect.objectContaining({ id: 'm-1', caption: 'cap1', order: 0 }),
        expect.objectContaining({ id: 'existing-1', caption: 'cap-existing', order: 1 }),
        expect.objectContaining({ id: 'm-2', caption: 'cap2', order: 2 }),
      ]);
      expect(result.mediaUploadResults.successCount).toBe(2);
      expect(result.mediaUploadResults.failedCount).toBe(0);
    });

    it('skips failed media uploads but keeps successful ones', async () => {
      mediaUtilMocks.uploadMediaInstructionFile
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ id: 'm-2', path: 'mp/2', order: 0 });
      firestoreMocks.setDocument.mockResolvedValue();

      const result = await RecipeService.create({
        recipeData: { name: 'Cake', category: 'desserts' },
        mediaItemsOrdered: [
          { file: makeFile('m1.jpg'), caption: 'cap1' },
          { file: makeFile('m2.jpg'), caption: 'cap2' },
        ],
        uploadedBy: 'user-1',
      });

      const payload = firestoreMocks.setDocument.mock.calls[0][2];
      expect(payload.mediaInstructions).toEqual([
        expect.objectContaining({ id: 'm-2', caption: 'cap2', order: 0 }),
      ]);
      expect(result.mediaUploadResults.successCount).toBe(1);
      expect(result.mediaUploadResults.failedCount).toBe(1);
      expect(result.mediaUploadResults.totalPending).toBe(2);
    });

    it('strips undefined recipeData fields', async () => {
      firestoreMocks.setDocument.mockResolvedValue();
      await RecipeService.create({
        recipeData: { name: 'Cake', category: 'desserts', attribution: undefined },
        uploadedBy: 'user-1',
      });
      const payload = firestoreMocks.setDocument.mock.calls[0][2];
      expect(payload).not.toHaveProperty('attribution');
    });

    it('throws when recipeData is missing', async () => {
      await expect(RecipeService.create({})).rejects.toThrow('recipeData is required');
    });
  });

  describe('update', () => {
    beforeEach(() => {
      firestoreMocks.getDocument.mockResolvedValue({
        id: 'recipe-9',
        category: 'desserts',
        images: [],
      });
      firestoreMocks.updateDocument.mockResolvedValue();
    });

    it('throws when recipe is missing', async () => {
      firestoreMocks.getDocument.mockResolvedValue(null);
      await expect(RecipeService.update('missing', { changes: {} })).rejects.toThrow('not found');
    });

    it('deletes removed images, uploads new ones, keeps existing', async () => {
      recipeImageServiceMocks.uploadFile.mockResolvedValueOnce({
        id: 'img-new',
        full: 'p/new.jpg',
      });

      await RecipeService.update('recipe-9', {
        changes: { name: 'Updated' },
        images: [
          { source: 'existing', id: 'img-old', full: 'p/old.jpg', isPrimary: true },
          { source: 'new', file: makeFile('new.jpg'), isPrimary: false },
        ],
        imagesToDelete: [{ id: 'img-rm', full: 'p/rm.jpg' }],
        uploadedBy: 'user-1',
        approved: true,
      });

      expect(recipeImageServiceMocks.deleteFiles).toHaveBeenCalledWith({
        id: 'img-rm',
        full: 'p/rm.jpg',
      });
      expect(recipeImageServiceMocks.uploadFile).toHaveBeenCalledTimes(1);
      const payload = firestoreMocks.updateDocument.mock.calls[0][2];
      expect(payload.approved).toBe(true);
      expect(payload.images.map((i) => i.id)).toEqual(['img-old', 'img-new']);
    });

    it('patches only the supplied fields — omitted images/media are not wiped', async () => {
      await RecipeService.update('recipe-9', {
        changes: { relatedRecipes: ['r-1', 'r-2'] },
      });
      const payload = firestoreMocks.updateDocument.mock.calls[0][2];
      expect(payload).toEqual({ relatedRecipes: ['r-1', 'r-2'] });
      expect(payload).not.toHaveProperty('images');
      expect(payload).not.toHaveProperty('mediaInstructions');
      expect(payload).not.toHaveProperty('approved');
    });

    it('migrates existing images on category change', async () => {
      recipeImageServiceMocks.migrateFilesToCategory.mockResolvedValueOnce({
        id: 'img-keep',
        full: 'img/recipes/full/mains/recipe-9/keep.jpg',
      });

      await RecipeService.update('recipe-9', {
        changes: { category: 'mains' },
        images: [
          {
            source: 'existing',
            id: 'img-keep',
            full: 'img/recipes/full/desserts/recipe-9/keep.jpg',
          },
        ],
        uploadedBy: 'user-1',
      });

      expect(recipeImageServiceMocks.migrateFilesToCategory).toHaveBeenCalledWith(
        'recipe-9',
        expect.objectContaining({ id: 'img-keep' }),
        'mains',
      );
    });

    it('collects migration warnings when migration fails', async () => {
      recipeImageServiceMocks.migrateFilesToCategory.mockRejectedValueOnce(
        new Error('migrate failed'),
      );

      const result = await RecipeService.update('recipe-9', {
        changes: { category: 'mains' },
        images: [
          { source: 'existing', id: 'img-bad', full: 'img/recipes/full/desserts/recipe-9/x.jpg' },
        ],
        uploadedBy: 'user-1',
      });

      expect(result.migrationWarnings).toEqual([{ imageId: 'img-bad', error: 'migrate failed' }]);
    });

    it('rolls back uploaded images when an image upload throws mid-loop', async () => {
      recipeImageServiceMocks.uploadFile
        .mockResolvedValueOnce({ id: 'new-1', full: 'p/n1.jpg' })
        .mockRejectedValueOnce(new Error('upload boom'));

      await expect(
        RecipeService.update('recipe-9', {
          changes: {},
          images: [
            { source: 'new', file: makeFile('n1.jpg'), isPrimary: false },
            { source: 'new', file: makeFile('n2.jpg'), isPrimary: false },
          ],
          uploadedBy: 'user-1',
        }),
      ).rejects.toThrow('upload boom');

      expect(recipeImageServiceMocks.deleteFiles).toHaveBeenCalledWith({
        id: 'new-1',
        full: 'p/n1.jpg',
      });
      expect(firestoreMocks.updateDocument).not.toHaveBeenCalled();
    });

    it('writes the approved flag when explicitly provided', async () => {
      await RecipeService.update('recipe-9', {
        changes: { name: 'Updated' },
        approved: false,
        uploadedBy: 'user-1',
      });
      const payload = firestoreMocks.updateDocument.mock.calls[0][2];
      expect(payload.approved).toBe(false);
    });
  });

  describe('delete', () => {
    it('removes approved + pending image files, media, and the document', async () => {
      firestoreMocks.getDocument.mockResolvedValue({
        id: 'recipe-x',
        images: [
          { id: 'a', full: 'img/recipes/full/cat/recipe-x/a.jpg' },
          { id: 'b', full: 'img/recipes/full/cat/recipe-x/b.jpg' },
        ],
        pendingImages: [{ id: 'p1', full: 'img/recipes/full/cat/recipe-x/p1.jpg' }],
        mediaInstructions: [{ path: 'mp/1' }],
      });

      await RecipeService.delete('recipe-x');

      expect(recipeImageServiceMocks.deleteFiles).toHaveBeenCalledTimes(3);
      expect(recipeImageServiceMocks.deleteFiles).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a' }),
      );
      expect(recipeImageServiceMocks.deleteFiles).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'b' }),
      );
      expect(recipeImageServiceMocks.deleteFiles).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'p1' }),
      );
      expect(mediaUtilMocks.removeAllMediaInstructions).toHaveBeenCalledWith([{ path: 'mp/1' }]);
      expect(firestoreMocks.deleteDocument).toHaveBeenCalledWith('recipes', 'recipe-x');
      // The pre-delete updateDoc({ images: [], pendingImages: [] }) is gone now.
      expect(firestoreMocks.updateDocument).not.toHaveBeenCalled();
    });

    it('is idempotent when the recipe does not exist', async () => {
      firestoreMocks.getDocument.mockResolvedValue(null);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      await RecipeService.delete('missing');
      expect(recipeImageServiceMocks.deleteFiles).not.toHaveBeenCalled();
      expect(firestoreMocks.deleteDocument).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('skips media cleanup when there are no media instructions', async () => {
      firestoreMocks.getDocument.mockResolvedValue({ id: 'recipe-y' });
      await RecipeService.delete('recipe-y');
      expect(mediaUtilMocks.removeAllMediaInstructions).not.toHaveBeenCalled();
      expect(firestoreMocks.deleteDocument).toHaveBeenCalledWith('recipes', 'recipe-y');
    });

    it('logs but does not throw when an individual image deletion fails', async () => {
      firestoreMocks.getDocument.mockResolvedValue({
        id: 'recipe-z',
        images: [{ id: 'a', full: 'img/recipes/full/cat/recipe-z/a.jpg' }],
      });
      recipeImageServiceMocks.deleteFiles.mockRejectedValueOnce(new Error('boom'));
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(RecipeService.delete('recipe-z')).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalled();
      expect(firestoreMocks.deleteDocument).toHaveBeenCalledWith('recipes', 'recipe-z');
      warnSpy.mockRestore();
    });
  });

  describe('setPrimaryImage', () => {
    it('updates isPrimary on the matching image and clears the rest', async () => {
      firestoreMocks.getDocument.mockResolvedValue({
        id: 'recipe-9',
        images: [
          { id: 'a', isPrimary: true },
          { id: 'b', isPrimary: false },
        ],
      });
      firestoreMocks.updateDocument.mockResolvedValue();

      await RecipeService.setPrimaryImage('recipe-9', 'b');

      expect(firestoreMocks.updateDocument).toHaveBeenCalledWith('recipes', 'recipe-9', {
        images: [
          { id: 'a', isPrimary: false },
          { id: 'b', isPrimary: true },
        ],
      });
    });

    it('throws if the recipe has no images', async () => {
      firestoreMocks.getDocument.mockResolvedValue({ id: 'recipe-9' });
      await expect(RecipeService.setPrimaryImage('recipe-9', 'b')).rejects.toThrow(
        'no images to update',
      );
    });

    it('throws on missing recipeId / imageId', async () => {
      await expect(RecipeService.setPrimaryImage('', 'b')).rejects.toThrow('recipeId is required');
      await expect(RecipeService.setPrimaryImage('r', '')).rejects.toThrow('imageId is required');
    });
  });

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

    it('throws on missing recipeId / imageId / blob', async () => {
      await expect(RecipeService.replaceImage('', 'img-1', newBlob)).rejects.toThrow(
        'recipeId is required',
      );
      await expect(RecipeService.replaceImage('r', '', newBlob)).rejects.toThrow(
        'imageId is required',
      );
      await expect(RecipeService.replaceImage('r', 'i', null)).rejects.toThrow('blob is required');
    });

    it('throws if the recipe is not found', async () => {
      firestoreMocks.getDocument.mockResolvedValue(null);
      await expect(RecipeService.replaceImage('missing', 'img-1', newBlob)).rejects.toThrow(
        'recipe missing not found',
      );
      expect(recipeImageServiceMocks.replaceFiles).not.toHaveBeenCalled();
    });

    it('throws if the image id is not on the recipe', async () => {
      setupRecipeWithImage();
      await expect(RecipeService.replaceImage('recipe-9', 'no-such-img', newBlob)).rejects.toThrow(
        'image no-such-img not found',
      );
      expect(recipeImageServiceMocks.replaceFiles).not.toHaveBeenCalled();
    });

    it('delegates Storage work to RecipeImageService.replaceFiles and returns its result', async () => {
      setupRecipeWithImage();
      recipeImageServiceMocks.replaceFiles.mockResolvedValueOnce({
        backupPath: 'img/recipes/full/desserts/recipe-9/img-1_original.jpg',
        backupCreated: true,
      });

      const result = await RecipeService.replaceImage('recipe-9', 'img-1', newBlob);

      expect(recipeImageServiceMocks.replaceFiles).toHaveBeenCalledWith(
        'recipe-9',
        expect.objectContaining({
          id: 'img-1',
          full: 'img/recipes/full/desserts/recipe-9/img-1.jpg',
        }),
        newBlob,
        { keepOriginalBackup: true },
      );
      expect(result).toEqual({
        backupPath: 'img/recipes/full/desserts/recipe-9/img-1_original.jpg',
        backupCreated: true,
      });
    });

    it('forwards keepOriginalBackup=false to replaceFiles', async () => {
      setupRecipeWithImage();

      await RecipeService.replaceImage('recipe-9', 'img-1', newBlob, {
        keepOriginalBackup: false,
      });

      expect(recipeImageServiceMocks.replaceFiles).toHaveBeenCalledWith(
        'recipe-9',
        expect.any(Object),
        newBlob,
        { keepOriginalBackup: false },
      );
    });

    it('applies fieldUpdates to the matching image entry on the recipe doc', async () => {
      setupRecipeWithImage();

      await RecipeService.replaceImage('recipe-9', 'img-1', newBlob, {
        fieldUpdates: { aiEnhanced: true },
      });

      const updateCall = firestoreMocks.updateDocument.mock.calls[0];
      expect(updateCall[0]).toBe('recipes');
      expect(updateCall[1]).toBe('recipe-9');
      const updatedImages = updateCall[2].images;
      expect(updatedImages.find((i) => i.id === 'img-1').aiEnhanced).toBe(true);
      expect(updatedImages.find((i) => i.id === 'img-2').aiEnhanced).toBeUndefined();
      expect(updatedImages.find((i) => i.id === 'img-1').isPrimary).toBe(true);
    });

    it('skips the doc patch when fieldUpdates is empty or missing', async () => {
      setupRecipeWithImage();

      await RecipeService.replaceImage('recipe-9', 'img-1', newBlob);
      expect(firestoreMocks.updateDocument).not.toHaveBeenCalled();

      await RecipeService.replaceImage('recipe-9', 'img-1', newBlob, { fieldUpdates: {} });
      expect(firestoreMocks.updateDocument).not.toHaveBeenCalled();
    });

    it('treats a fieldUpdates write failure as best-effort (logs, does not throw)', async () => {
      setupRecipeWithImage();
      firestoreMocks.updateDocument.mockRejectedValue(new Error('boom'));
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        RecipeService.replaceImage('recipe-9', 'img-1', newBlob, {
          fieldUpdates: { aiEnhanced: true },
        }),
      ).resolves.toMatchObject({ backupCreated: true });

      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });
});
