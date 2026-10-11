import { jest } from '@jest/globals';

import '../../common/mocks/firebase-firestore.mock.js';

let RecipeSubmissionService;

const firestoreMocks = {
  getDocument: jest.fn(),
  setDocument: jest.fn(),
  updateDocument: jest.fn(),
  deleteDocument: jest.fn(),
  queryDocuments: jest.fn(),
};

const recipeServiceMocks = {
  get: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

jest.unstable_mockModule('src/js/services/_firebase/firestore-service.js', () => ({
  FirestoreService: firestoreMocks,
}));
jest.unstable_mockModule('src/js/services/recipes/recipe-service.js', () => ({
  RecipeService: recipeServiceMocks,
  VISIBILITY: { PRIVATE: 'private', PUBLISHED: 'published' },
}));

beforeEach(async () => {
  jest.resetModules();
  Object.values(firestoreMocks).forEach((m) => m.mockReset());
  Object.values(recipeServiceMocks).forEach((m) => m.mockReset());
  firestoreMocks.deleteDocument.mockResolvedValue();
  firestoreMocks.updateDocument.mockResolvedValue();
  ({ RecipeSubmissionService } =
    await import('src/js/services/recipes/recipe-submission-service.js'));
});

describe('RecipeSubmissionService', () => {
  describe('submit', () => {
    it('writes a pending submission keyed by the recipe id', async () => {
      await RecipeSubmissionService.submit({ recipeId: 'r1', authorId: 'u1' });
      const [collection, id, data] = firestoreMocks.setDocument.mock.calls[0];
      expect(collection).toBe('recipe_submissions');
      expect(id).toBe('r1');
      expect(data).toMatchObject({
        recipeId: 'r1',
        authorId: 'u1',
        status: 'pending',
        reviewedBy: null,
        publishedId: null,
      });
      expect(data.createdAt).toBeDefined();
    });

    it('requires a recipe and an author', async () => {
      await expect(RecipeSubmissionService.submit({ authorId: 'u1' })).rejects.toThrow();
      await expect(RecipeSubmissionService.submit({ recipeId: 'r1' })).rejects.toThrow();
      expect(firestoreMocks.setDocument).not.toHaveBeenCalled();
    });
  });

  describe('submissionWrite', () => {
    it('builds the same pending submission as a batch operation', () => {
      const op = RecipeSubmissionService.submissionWrite({ recipeId: 'r1', authorId: 'u1' });
      expect(op).toMatchObject({
        type: 'set',
        collection: 'recipe_submissions',
        id: 'r1',
        data: { recipeId: 'r1', authorId: 'u1', status: 'pending' },
      });
      expect(() => RecipeSubmissionService.submissionWrite({ recipeId: 'r1' })).toThrow();
    });
  });

  describe('listPending', () => {
    it('returns pending submissions with their recipes, newest first', async () => {
      firestoreMocks.queryDocuments.mockResolvedValue([
        { id: 'old', recipeId: 'old', createdAt: { seconds: 1 } },
        { id: 'new', recipeId: 'new', createdAt: { seconds: 2 } },
      ]);
      recipeServiceMocks.get.mockImplementation(async (id) => ({ id, visibility: 'private' }));

      const rows = await RecipeSubmissionService.listPending();

      expect(firestoreMocks.queryDocuments).toHaveBeenCalledWith('recipe_submissions', {
        where: [['status', '==', 'pending']],
      });
      expect(rows.map((r) => r.recipe.id)).toEqual(['new', 'old']);
    });

    it('removes a submission whose recipe no longer exists', async () => {
      firestoreMocks.queryDocuments.mockResolvedValue([{ id: 'gone', recipeId: 'gone' }]);
      recipeServiceMocks.get.mockResolvedValue(null);

      expect(await RecipeSubmissionService.listPending()).toEqual([]);
      expect(firestoreMocks.deleteDocument).toHaveBeenCalledWith('recipe_submissions', 'gone');
    });

    it('marks approved a submission whose recipe a manager already published', async () => {
      firestoreMocks.queryDocuments.mockResolvedValue([{ id: 'r1', recipeId: 'r1' }]);
      recipeServiceMocks.get.mockResolvedValue({ id: 'r1', visibility: 'published' });

      expect(await RecipeSubmissionService.listPending()).toEqual([]);
      expect(firestoreMocks.updateDocument).toHaveBeenCalledWith(
        'recipe_submissions',
        'r1',
        expect.objectContaining({ status: 'approved', publishedId: 'r1' }),
      );
    });
  });

  describe('approve', () => {
    it('publishes the recipe first, then records the approval', async () => {
      const order = [];
      recipeServiceMocks.update.mockImplementation(async () => order.push('recipe'));
      firestoreMocks.getDocument.mockResolvedValue({ id: 'r1', status: 'pending' });
      firestoreMocks.updateDocument.mockImplementation(async () => order.push('submission'));

      await RecipeSubmissionService.approve('r1', { reviewedBy: 'm1' });

      expect(recipeServiceMocks.update).toHaveBeenCalledWith('r1', { approved: true });
      expect(firestoreMocks.updateDocument).toHaveBeenCalledWith(
        'recipe_submissions',
        'r1',
        expect.objectContaining({ status: 'approved', reviewedBy: 'm1', publishedId: 'r1' }),
      );
      expect(order).toEqual(['recipe', 'submission']);
    });

    it('still publishes a recipe that has no submission record', async () => {
      firestoreMocks.getDocument.mockResolvedValue(null);
      await RecipeSubmissionService.approve('r1', { reviewedBy: 'm1' });
      expect(recipeServiceMocks.update).toHaveBeenCalledWith('r1', { approved: true });
      expect(firestoreMocks.updateDocument).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('keeps the recipe and records the note', async () => {
      await RecipeSubmissionService.reject('r1', { note: '  חסרות כמויות  ', reviewedBy: 'm1' });
      expect(recipeServiceMocks.delete).not.toHaveBeenCalled();
      const [collection, id, data] = firestoreMocks.updateDocument.mock.calls[0];
      expect([collection, id]).toEqual(['recipe_submissions', 'r1']);
      expect(data).toMatchObject({
        status: 'rejected',
        rejectionReason: 'חסרות כמויות',
        reviewedBy: 'm1',
      });
      expect(data.reviewedAt).toBeDefined();
    });

    it('requires a note', async () => {
      await expect(RecipeSubmissionService.reject('r1', { note: '   ' })).rejects.toThrow(
        'a note is required',
      );
      expect(firestoreMocks.updateDocument).not.toHaveBeenCalled();
    });
  });

  describe('discard', () => {
    it('deletes a plain user’s proposal and its submission', async () => {
      await RecipeSubmissionService.discard('r1');
      expect(recipeServiceMocks.delete).toHaveBeenCalledWith('r1');
      expect(firestoreMocks.deleteDocument).toHaveBeenCalledWith('recipe_submissions', 'r1');
    });
  });

  describe('author actions', () => {
    it('resubmit: back to pending, stamped by the server', async () => {
      await RecipeSubmissionService.resubmit('r1');
      const [collection, id, data] = firestoreMocks.updateDocument.mock.calls[0];
      expect([collection, id, data.status]).toEqual(['recipe_submissions', 'r1', 'pending']);
      expect(data.resubmittedAt).toBeDefined();
      expect(Object.keys(data).sort()).toEqual(['resubmittedAt', 'status']);
    });

    it('cancel deletes the submission and reports failures', async () => {
      firestoreMocks.deleteDocument.mockRejectedValueOnce(new Error('denied'));
      await expect(RecipeSubmissionService.cancel('r1')).rejects.toThrow('denied');
      expect(firestoreMocks.deleteDocument).toHaveBeenCalledWith('recipe_submissions', 'r1');
    });

    it('listForAuthor queries the author’s submissions', async () => {
      firestoreMocks.queryDocuments.mockResolvedValue([{ id: 'r1' }]);
      expect(await RecipeSubmissionService.listForAuthor('u1')).toEqual([{ id: 'r1' }]);
      expect(firestoreMocks.queryDocuments).toHaveBeenCalledWith('recipe_submissions', {
        where: [['authorId', '==', 'u1']],
      });
      expect(await RecipeSubmissionService.listForAuthor(null)).toEqual([]);
    });
  });
});
