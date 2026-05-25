import { jest } from '@jest/globals';

import '../../common/mocks/firebase-firestore.mock.js';
import '../../common/mocks/firebase-storage.mock.js';
import '../../common/mocks/firebase-service.mock.js';

let RecipeImageProposalService;

const firestoreMocks = {
  getDocument: jest.fn(),
  updateDocument: jest.fn(),
};

const storageMocks = {
  uploadFile: jest.fn(() => Promise.resolve()),
};

const recipeImageServiceMocks = {
  deleteFiles: jest.fn(() => Promise.resolve()),
};

jest.unstable_mockModule('src/js/services/_firebase/firestore-service.js', () => ({
  FirestoreService: firestoreMocks,
}));
jest.unstable_mockModule('src/js/services/_firebase/storage-service.js', () => ({
  StorageService: storageMocks,
}));
jest.unstable_mockModule('src/js/services/recipes/recipe-image-service.js', () => ({
  RecipeImageService: recipeImageServiceMocks,
}));

function makeFile(name = 'a.jpg', type = 'image/jpeg') {
  return new File([new Blob(['a'], { type })], name, { type });
}

beforeEach(async () => {
  jest.resetModules();
  Object.values(firestoreMocks).forEach((m) => m.mockReset?.());
  Object.values(storageMocks).forEach((m) => m.mockReset?.());
  storageMocks.uploadFile.mockImplementation(() => Promise.resolve());
  Object.values(recipeImageServiceMocks).forEach((m) => m.mockReset?.());
  recipeImageServiceMocks.deleteFiles.mockImplementation(() => Promise.resolve());

  ({ RecipeImageProposalService } = await import(
    'src/js/services/recipes/recipe-image-proposal-service.js'
  ));
});

describe('RecipeImageProposalService', () => {
  describe('propose', () => {
    it('returns an empty array (and skips reads/writes) when no files are passed', async () => {
      await expect(RecipeImageProposalService.propose('r1', [], 'cat', 'u1')).resolves.toEqual([]);
      await expect(RecipeImageProposalService.propose('r1', null, 'cat', 'u1')).resolves.toEqual(
        [],
      );
      expect(firestoreMocks.getDocument).not.toHaveBeenCalled();
      expect(firestoreMocks.updateDocument).not.toHaveBeenCalled();
    });

    it('uploads each file to its category path and appends entries to pendingImages', async () => {
      firestoreMocks.getDocument.mockResolvedValue({
        id: 'r1',
        pendingImages: [{ id: 'existing', full: 'x' }],
      });
      const files = [makeFile('a.jpg'), makeFile('b.png', 'image/png')];

      const result = await RecipeImageProposalService.propose('r1', files, 'desserts', 'user-1');

      expect(storageMocks.uploadFile).toHaveBeenCalledTimes(2);
      // Storage paths include the new id + extension under the category prefix.
      const paths = storageMocks.uploadFile.mock.calls.map((args) => args[1]);
      expect(paths[0]).toMatch(/^img\/recipes\/full\/desserts\/r1\/img-\d+-[a-z0-9]+\.jpg$/);
      expect(paths[1]).toMatch(/^img\/recipes\/full\/desserts\/r1\/img-\d+-[a-z0-9]+\.png$/);

      // updateDocument receives existing + new entries, in that order.
      const update = firestoreMocks.updateDocument.mock.calls[0];
      expect(update[0]).toBe('recipes');
      expect(update[1]).toBe('r1');
      const persisted = update[2].pendingImages;
      expect(persisted).toHaveLength(3);
      expect(persisted[0]).toEqual({ id: 'existing', full: 'x' });
      expect(persisted[1]).toMatchObject({
        fileExtension: 'jpg',
        uploadedBy: 'user-1',
      });
      expect(persisted[2]).toMatchObject({
        fileExtension: 'png',
        uploadedBy: 'user-1',
      });

      // Return value is just the new entries.
      expect(result).toHaveLength(2);
      expect(result.every((e) => e.uploadedBy === 'user-1')).toBe(true);
    });

    it('starts with an empty pendingImages array when the recipe has none yet', async () => {
      firestoreMocks.getDocument.mockResolvedValue({ id: 'r1' });
      const files = [makeFile()];

      await RecipeImageProposalService.propose('r1', files, 'cat', 'user-1');

      const persisted = firestoreMocks.updateDocument.mock.calls[0][2].pendingImages;
      expect(persisted).toHaveLength(1);
    });
  });

  describe('approve', () => {
    it('moves the pending entry into images[] as a typed RecipeImage and removes it from pendingImages', async () => {
      firestoreMocks.getDocument.mockResolvedValue({
        id: 'r1',
        images: [{ id: 'existing', isPrimary: true }],
        pendingImages: [
          {
            id: 'p1',
            full: 'img/recipes/full/cat/r1/p1.jpg',
            fileExtension: 'jpg',
            uploadedBy: 'u1',
          },
          {
            id: 'p2',
            full: 'img/recipes/full/cat/r1/p2.jpg',
            fileExtension: 'jpg',
            uploadedBy: 'u2',
          },
        ],
      });

      const newId = await RecipeImageProposalService.approve('r1', 'p1');

      expect(typeof newId).toBe('string');
      expect(newId).toMatch(/^img-/);

      const update = firestoreMocks.updateDocument.mock.calls[0];
      expect(update[0]).toBe('recipes');
      expect(update[1]).toBe('r1');
      const { images, pendingImages } = update[2];
      // New image appended (not primary — recipe already had approved images).
      expect(images).toHaveLength(2);
      expect(images[1]).toMatchObject({
        id: newId,
        full: 'img/recipes/full/cat/r1/p1.jpg',
        isPrimary: false,
        access: 'public',
        uploadedBy: 'u1',
        fileName: 'p1.jpg',
      });
      // Only p2 left pending.
      expect(pendingImages).toEqual([expect.objectContaining({ id: 'p2' })]);
    });

    it('marks the approved entry as primary when the recipe had no approved images yet', async () => {
      firestoreMocks.getDocument.mockResolvedValue({
        id: 'r1',
        pendingImages: [{ id: 'p1', full: 'p/1', fileExtension: 'jpg', uploadedBy: 'u1' }],
      });

      await RecipeImageProposalService.approve('r1', 'p1');

      const images = firestoreMocks.updateDocument.mock.calls[0][2].images;
      expect(images).toHaveLength(1);
      expect(images[0].isPrimary).toBe(true);
    });

    it('throws when there are no pending images', async () => {
      firestoreMocks.getDocument.mockResolvedValue({ id: 'r1' });
      await expect(RecipeImageProposalService.approve('r1', 'p1')).rejects.toThrow(
        'No pending images to approve',
      );
    });

    it('throws when the pending image id is not found', async () => {
      firestoreMocks.getDocument.mockResolvedValue({
        id: 'r1',
        pendingImages: [{ id: 'other' }],
      });
      await expect(RecipeImageProposalService.approve('r1', 'p1')).rejects.toThrow(
        'Pending image not found',
      );
    });
  });

  describe('reject', () => {
    it('deletes the pending Storage files via RecipeImageService.deleteFiles and trims the pending entry', async () => {
      firestoreMocks.getDocument.mockResolvedValue({
        id: 'r1',
        pendingImages: [
          { id: 'p1', full: 'img/recipes/full/cat/r1/p1.jpg' },
          { id: 'p2', full: 'img/recipes/full/cat/r1/p2.jpg' },
        ],
      });

      await RecipeImageProposalService.reject('r1', 'p1');

      expect(recipeImageServiceMocks.deleteFiles).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'p1' }),
      );
      const update = firestoreMocks.updateDocument.mock.calls[0];
      expect(update[2].pendingImages).toEqual([expect.objectContaining({ id: 'p2' })]);
    });

    it('throws when there are no pending images', async () => {
      firestoreMocks.getDocument.mockResolvedValue({ id: 'r1' });
      await expect(RecipeImageProposalService.reject('r1', 'p1')).rejects.toThrow(
        'No pending images to reject',
      );
      expect(recipeImageServiceMocks.deleteFiles).not.toHaveBeenCalled();
    });

    it('throws when the pending image id is not found', async () => {
      firestoreMocks.getDocument.mockResolvedValue({
        id: 'r1',
        pendingImages: [{ id: 'other' }],
      });
      await expect(RecipeImageProposalService.reject('r1', 'p1')).rejects.toThrow(
        'Pending image not found',
      );
      expect(recipeImageServiceMocks.deleteFiles).not.toHaveBeenCalled();
    });
  });

  describe('listPending', () => {
    it('returns the pending images array', async () => {
      firestoreMocks.getDocument.mockResolvedValue({
        id: 'r1',
        pendingImages: [{ id: 'p1' }, { id: 'p2' }],
      });
      const result = await RecipeImageProposalService.listPending('r1');
      expect(result).toEqual([{ id: 'p1' }, { id: 'p2' }]);
    });

    it('returns an empty array when the recipe has no pendingImages', async () => {
      firestoreMocks.getDocument.mockResolvedValue({ id: 'r1' });
      await expect(RecipeImageProposalService.listPending('r1')).resolves.toEqual([]);
    });

    it('returns an empty array when the recipe document is missing', async () => {
      firestoreMocks.getDocument.mockResolvedValue(null);
      await expect(RecipeImageProposalService.listPending('r1')).resolves.toEqual([]);
    });
  });
});
