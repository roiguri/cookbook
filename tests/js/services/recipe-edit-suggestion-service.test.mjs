import { jest } from '@jest/globals';

import '../../common/mocks/firebase-firestore.mock.js';
import '../../common/mocks/firebase-storage.mock.js';
import '../../common/mocks/firebase-service.mock.js';

let RecipeEditSuggestionService;

const firestoreMocks = {
  getDocument: jest.fn(),
  setDocument: jest.fn(),
  updateDocument: jest.fn(),
  queryDocuments: jest.fn(),
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
const promoteCallable = jest.fn();
jest.unstable_mockModule('firebase/functions', () => ({
  getFunctions: jest.fn(() => ({})),
  httpsCallable: jest.fn(() => promoteCallable),
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
  promoteCallable.mockReset();

  ({ RecipeEditSuggestionService } =
    await import('src/js/services/recipes/recipe-edit-suggestion-service.js'));
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
    // Real uploadFile returns isPrimary per the flag it was called with — the
    // service forces non-primary uploads, so the mock mirrors that.
    recipeImageServiceMocks.uploadFile.mockResolvedValue({
      id: 'img-new',
      full: 'suggestions/sug-1/images/img-new.jpg',
      isPrimary: false,
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
    // Uploaded non-primary, into the suggestion's own folder (never the live recipe's).
    expect(recipeImageServiceMocks.uploadFile).toHaveBeenCalledWith(
      'r1',
      expect.anything(),
      expect.objectContaining({ isPrimary: false, folder: 'suggestions/sug-1/images' }),
    );

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
    // "Make primary" intent is preserved on the stored metadata (realized at approval),
    // even though the file itself was uploaded non-primary.
    expect(doc.proposedChanges.images[0]).toMatchObject({ id: 'img-new', isPrimary: true });
    expect(doc.proposedChanges.images[1]).toEqual({
      id: 'keep',
      full: 'img/keep.jpg',
      isPrimary: false,
    });
    expect(doc.proposedChanges.images[1].source).toBeUndefined();

    // Uploaded image path is tracked for cleanup-on-reject.
    expect(doc.storagePaths).toEqual([
      { type: 'image', path: 'suggestions/sug-1/images/img-new.jpg' },
    ]);
  });

  it('denormalizes the suggester name (null when not provided)', async () => {
    firestoreMocks.getDocument.mockResolvedValue({ id: 'r1', name: 'R', category: 'cat' });

    await RecipeEditSuggestionService.create({
      recipeId: 'r1',
      suggestedBy: 'u1',
      suggestedByName: 'רות',
      proposedChanges: { name: 'R', images: [] },
    });
    expect(firestoreMocks.setDocument.mock.calls[0][2].suggestedByName).toBe('רות');

    firestoreMocks.setDocument.mockClear();
    await RecipeEditSuggestionService.create({
      recipeId: 'r1',
      suggestedBy: 'u1',
      proposedChanges: { name: 'R', images: [] },
    });
    expect(firestoreMocks.setDocument.mock.calls[0][2].suggestedByName).toBeNull();
  });

  it('stores an empty mediaInstructions array when the suggestion clears all media', async () => {
    firestoreMocks.getDocument.mockResolvedValue({ id: 'r1', name: 'R', category: 'cat' });

    await RecipeEditSuggestionService.create({
      recipeId: 'r1',
      suggestedBy: 'u1',
      proposedChanges: { name: 'R', images: [] },
      mediaItemsOrdered: [], // suggester removed all media
    });

    const doc = firestoreMocks.setDocument.mock.calls[0][2];
    // Present (not absent) so approval can tell "cleared" from "untouched".
    expect(doc.proposedChanges.mediaInstructions).toEqual([]);
  });

  it('uploads pending media items and records their paths', async () => {
    firestoreMocks.getDocument.mockResolvedValue({ id: 'r1', name: 'R', category: 'cat' });
    mediaInstructionServiceMocks.upload.mockResolvedValue({
      id: 'med-1',
      path: 'suggestions/sug-1/media/med-1_a.mp4',
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
    expect(mediaInstructionServiceMocks.upload).toHaveBeenCalledWith(
      expect.anything(),
      'r1',
      'u1',
      undefined,
      { folder: 'suggestions/sug-1/media' },
    );
    expect(doc.proposedChanges.mediaInstructions).toHaveLength(2);
    expect(doc.proposedChanges.mediaInstructions[0]).toMatchObject({ id: 'med-1', order: 0 });
    expect(doc.proposedChanges.mediaInstructions[1]).toMatchObject({
      id: 'existing-media',
      order: 1,
    });
    expect(doc.storagePaths).toEqual([
      { type: 'media', path: 'suggestions/sug-1/media/med-1_a.mp4' },
    ]);
  });
});

describe('RecipeEditSuggestionService.listPending', () => {
  it('queries pending suggestions and sorts newest first', async () => {
    firestoreMocks.queryDocuments.mockResolvedValue([
      { id: 's1', createdAt: { seconds: 100 } },
      { id: 's2', createdAt: { seconds: 300 } },
      { id: 's3', createdAt: { seconds: 200 } },
    ]);

    const result = await RecipeEditSuggestionService.listPending();

    expect(firestoreMocks.queryDocuments).toHaveBeenCalledWith('recipe_edit_suggestions', {
      where: [['status', '==', 'pending']],
    });
    expect(result.map((s) => s.id)).toEqual(['s2', 's3', 's1']);
  });
});

describe('RecipeEditSuggestionService.approve', () => {
  it('stamps the suggestion approved with reviewer + timestamp', async () => {
    await RecipeEditSuggestionService.approve('sug-1', { reviewedBy: 'mgr' });
    expect(firestoreMocks.updateDocument).toHaveBeenCalledWith('recipe_edit_suggestions', 'sug-1', {
      status: 'approved',
      reviewedBy: 'mgr',
      reviewedAt: 'mock-timestamp-now',
    });
    // No recipeId → no sibling query/supersede.
    expect(firestoreMocks.queryDocuments).not.toHaveBeenCalled();
  });

  it('supersedes other pending suggestions for the recipe when recipeId is given', async () => {
    firestoreMocks.queryDocuments.mockResolvedValue([
      { id: 'sug-1', status: 'pending', storagePaths: [] },
      { id: 'sug-2', status: 'pending', storagePaths: [{ type: 'image', path: 'img/x.jpg' }] },
      { id: 'sug-3', status: 'approved', storagePaths: [] },
    ]);

    await RecipeEditSuggestionService.approve('sug-1', { reviewedBy: 'mgr', recipeId: 'r1' });

    // Queried siblings by recipeId (single field — no composite index).
    expect(firestoreMocks.queryDocuments).toHaveBeenCalledWith('recipe_edit_suggestions', {
      where: [['recipeId', '==', 'r1']],
    });
    // sug-2 (other pending) superseded + its storage cleaned; sug-1 (approved) and
    // sug-3 (already terminal) untouched by supersede.
    expect(recipeImageServiceMocks.deleteFiles).toHaveBeenCalledWith({ full: 'img/x.jpg' });
    expect(firestoreMocks.updateDocument).toHaveBeenCalledWith('recipe_edit_suggestions', 'sug-2', {
      status: 'superseded',
      reviewedBy: 'mgr',
      reviewedAt: 'mock-timestamp-now',
    });
    const supersededIds = firestoreMocks.updateDocument.mock.calls
      .filter((c) => c[2].status === 'superseded')
      .map((c) => c[1]);
    expect(supersededIds).toEqual(['sug-2']);
  });

  it('throws without a suggestionId', async () => {
    await expect(RecipeEditSuggestionService.approve()).rejects.toThrow('suggestionId is required');
  });

  it('deletes the staged suggestion files once approved (they were copied into the recipe)', async () => {
    firestoreMocks.getDocument.mockResolvedValue({
      id: 'sug-1',
      storagePaths: [
        { type: 'image', path: 'suggestions/sug-1/images/a.jpg' },
        { type: 'media', path: 'suggestions/sug-1/media/m_b.mp4' },
        { type: 'image', path: 'img/recipes/full/x/r1/legacy.jpg' }, // pre-2b: lives in the recipe
      ],
    });
    await RecipeEditSuggestionService.approve('sug-1', { reviewedBy: 'mgr' });
    expect(recipeImageServiceMocks.deleteFiles).toHaveBeenCalledWith({
      full: 'suggestions/sug-1/images/a.jpg',
    });
    expect(mediaInstructionServiceMocks.delete).toHaveBeenCalledWith(
      'suggestions/sug-1/media/m_b.mp4',
    );
    expect(recipeImageServiceMocks.deleteFiles).not.toHaveBeenCalledWith({
      full: 'img/recipes/full/x/r1/legacy.jpg',
    });
  });
});

describe('RecipeEditSuggestionService.promoteFiles', () => {
  it('returns the changes untouched when nothing is staged (pre-2b suggestions)', async () => {
    const proposedChanges = { images: [{ full: 'img/recipes/full/x/r1/a.jpg' }] };
    const result = await RecipeEditSuggestionService.promoteFiles({
      id: 'sug-1',
      proposedChanges,
      storagePaths: [{ type: 'image', path: 'img/recipes/full/x/r1/a.jpg' }],
    });
    expect(result).toBe(proposedChanges);
    expect(promoteCallable).not.toHaveBeenCalled();
  });

  it('copies staged files server-side and repoints the changes at the copies', async () => {
    promoteCallable.mockResolvedValue({
      data: {
        mapping: {
          'suggestions/sug-1/images/a.jpg': 'recipes/r1/images/a.jpg',
          'suggestions/sug-1/media/m_b.mp4': 'recipes/r1/media/m_b.mp4',
        },
      },
    });
    const result = await RecipeEditSuggestionService.promoteFiles({
      id: 'sug-1',
      storagePaths: [
        { type: 'image', path: 'suggestions/sug-1/images/a.jpg' },
        { type: 'media', path: 'suggestions/sug-1/media/m_b.mp4' },
      ],
      proposedChanges: {
        name: 'Soup',
        images: [{ id: 'i1', full: 'suggestions/sug-1/images/a.jpg', isPrimary: true }],
        mediaInstructions: [{ id: 'm1', path: 'suggestions/sug-1/media/m_b.mp4' }],
      },
    });
    expect(promoteCallable).toHaveBeenCalledWith({ suggestionId: 'sug-1' });
    expect(result).toEqual({
      name: 'Soup',
      images: [{ id: 'i1', full: 'recipes/r1/images/a.jpg', isPrimary: true }],
      mediaInstructions: [{ id: 'm1', path: 'recipes/r1/media/m_b.mp4' }],
    });
  });
});

describe('RecipeEditSuggestionService.reject', () => {
  it('deletes suggestion-owned image and media files, then stamps rejected', async () => {
    firestoreMocks.getDocument.mockResolvedValue({
      id: 'sug-1',
      storagePaths: [
        { type: 'image', path: 'img/recipes/full/cat/r1/img-new.jpg' },
        { type: 'media', path: 'recipes/r1/media-instructions/med-1.mp4' },
      ],
    });

    await RecipeEditSuggestionService.reject('sug-1', { reviewedBy: 'mgr', rejectionReason: 'no' });

    expect(recipeImageServiceMocks.deleteFiles).toHaveBeenCalledWith({
      full: 'img/recipes/full/cat/r1/img-new.jpg',
    });
    expect(mediaInstructionServiceMocks.delete).toHaveBeenCalledWith(
      'recipes/r1/media-instructions/med-1.mp4',
    );
    expect(firestoreMocks.updateDocument).toHaveBeenCalledWith('recipe_edit_suggestions', 'sug-1', {
      status: 'rejected',
      rejectionReason: 'no',
      reviewedBy: 'mgr',
      reviewedAt: 'mock-timestamp-now',
    });
  });

  it('throws when the suggestion does not exist', async () => {
    firestoreMocks.getDocument.mockResolvedValue(null);
    await expect(RecipeEditSuggestionService.reject('missing')).rejects.toThrow(
      'Suggestion not found',
    );
  });
});
