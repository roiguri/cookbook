import { jest } from '@jest/globals';

import '../../common/mocks/firebase-firestore.mock.js';
import '../../common/mocks/firebase-storage.mock.js';
import '../../common/mocks/firebase-service.mock.js';

let RecipeEditSuggestionService;

const firestoreMocks = {
  getDocument: jest.fn(),
  setDocument: jest.fn(),
  generateId: jest.fn(() => 'sug-1'),
};

const recipeImageServiceMocks = {
  uploadFile: jest.fn(),
  deleteFiles: jest.fn(() => Promise.resolve()),
};

const mediaInstructionServiceMocks = {
  upload: jest.fn(),
  delete: jest.fn(() => Promise.resolve()),
};

jest.unstable_mockModule('src/js/services/_firebase/firestore-service.js', () => ({
  FirestoreService: firestoreMocks,
}));
jest.unstable_mockModule('src/js/services/recipes/recipe-image-service.js', () => ({
  RecipeImageService: recipeImageServiceMocks,
}));
jest.unstable_mockModule('src/js/services/recipes/media-instruction-service.js', () => ({
  MediaInstructionService: mediaInstructionServiceMocks,
}));

function makeFile(name = 'a.jpg', type = 'image/jpeg') {
  return new File([new Blob(['a'], { type })], name, { type });
}

beforeEach(async () => {
  jest.resetModules();
  Object.values(firestoreMocks).forEach((m) => m.mockReset?.());
  firestoreMocks.generateId.mockReturnValue('sug-1');
  Object.values(recipeImageServiceMocks).forEach((m) => m.mockReset?.());
  recipeImageServiceMocks.deleteFiles.mockResolvedValue(undefined);
  Object.values(mediaInstructionServiceMocks).forEach((m) => m.mockReset?.());
  mediaInstructionServiceMocks.delete.mockResolvedValue(undefined);

  ({ RecipeEditSuggestionService } = await import(
    'src/js/services/recipes/recipe-edit-suggestion-service.js'
  ));
});

describe('RecipeEditSuggestionService.create', () => {
  it('throws when the target recipe does not exist', async () => {
    firestoreMocks.getDocument.mockResolvedValue(null);
    await expect(
      RecipeEditSuggestionService.create({
        recipeId: 'r1',
        suggestedBy: 'u1',
        proposedChanges: { name: 'x' },
      }),
    ).rejects.toThrow('not found');
  });

  it('uploads new images, keeps existing ones, and writes a pending suggestion', async () => {
    firestoreMocks.getDocument.mockResolvedValue({
      id: 'r1',
      name: 'Old Name',
      category: 'desserts',
    });
    recipeImageServiceMocks.uploadFile.mockResolvedValue({
      id: 'img-new',
      full: 'img/recipes/full/desserts/r1/img-new.jpg',
      isPrimary: true,
    });

    const proposedChanges = {
      name: 'New Name',
      category: 'desserts',
      ingredients: ['a', 'b'],
      toDelete: [{ id: 'old', full: 'x' }],
      mediaToDelete: ['m/old'],
      images: [
        { source: 'new', file: makeFile(), isPrimary: true, preview: 'blob:1' },
        { source: 'existing', id: 'keep', full: 'img/keep.jpg', isPrimary: false },
      ],
    };

    const result = await RecipeEditSuggestionService.create({
      recipeId: 'r1',
      suggestedBy: 'u1',
      proposedChanges,
    });

    expect(result).toEqual({ suggestionId: 'sug-1' });
    expect(recipeImageServiceMocks.uploadFile).toHaveBeenCalledTimes(1);

    const write = firestoreMocks.setDocument.mock.calls[0];
    expect(write[0]).toBe('recipe_edit_suggestions');
    expect(write[1]).toBe('sug-1');
    const doc = write[2];

    expect(doc.status).toBe('pending');
    expect(doc.suggestedBy).toBe('u1');
    expect(doc.recipeName).toBe('Old Name');
    expect(doc.reviewedBy).toBeNull();
    expect(doc.createdAt).toBe('mock-timestamp-now');

    // toDelete / mediaToDelete are stripped from the stored suggestion.
    expect(doc.proposedChanges.toDelete).toBeUndefined();
    expect(doc.proposedChanges.mediaToDelete).toBeUndefined();
    expect(doc.proposedChanges.name).toBe('New Name');

    // Uploaded image becomes a plain metadata entry; existing kept without form-internal fields.
    expect(doc.proposedChanges.images).toHaveLength(2);
    expect(doc.proposedChanges.images[0]).toMatchObject({ id: 'img-new' });
    expect(doc.proposedChanges.images[1]).toEqual({
      id: 'keep',
      full: 'img/keep.jpg',
      isPrimary: false,
    });
    expect(doc.proposedChanges.images[1].source).toBeUndefined();

    // Uploaded image path is tracked for cleanup-on-reject.
    expect(doc.storagePaths).toEqual([
      { type: 'image', path: 'img/recipes/full/desserts/r1/img-new.jpg' },
    ]);
  });

  it('uploads pending media items and records their paths', async () => {
    firestoreMocks.getDocument.mockResolvedValue({ id: 'r1', name: 'R', category: 'cat' });
    mediaInstructionServiceMocks.upload.mockResolvedValue({
      id: 'med-1',
      path: 'recipes/r1/media-instructions/med-1_a.mp4',
      type: 'video',
    });

    await RecipeEditSuggestionService.create({
      recipeId: 'r1',
      suggestedBy: 'u1',
      proposedChanges: { name: 'R', images: [] },
      mediaItemsOrdered: [
        { file: makeFile('a.mp4', 'video/mp4'), caption: 'step 1' },
        { id: 'existing-media', path: 'recipes/r1/media-instructions/x.jpg', type: 'image' },
      ],
    });

    const doc = firestoreMocks.setDocument.mock.calls[0][2];
    expect(mediaInstructionServiceMocks.upload).toHaveBeenCalledTimes(1);
    expect(doc.proposedChanges.mediaInstructions).toHaveLength(2);
    expect(doc.proposedChanges.mediaInstructions[0]).toMatchObject({ id: 'med-1', order: 0 });
    expect(doc.proposedChanges.mediaInstructions[1]).toMatchObject({
      id: 'existing-media',
      order: 1,
    });
    expect(doc.storagePaths).toEqual([
      { type: 'media', path: 'recipes/r1/media-instructions/med-1_a.mp4' },
    ]);
  });
});
