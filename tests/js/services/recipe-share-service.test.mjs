import { jest } from '@jest/globals';

import '../../common/mocks/firebase-firestore.mock.js';

let RecipeShareService;

const firestoreMocks = {
  getDocument: jest.fn(),
  deleteDocument: jest.fn(),
  queryDocuments: jest.fn(),
  queryCollectionGroup: jest.fn(),
  batchWrite: jest.fn(),
};
const recipeServiceMocks = { get: jest.fn() };
const callable = jest.fn();

jest.unstable_mockModule('src/js/services/_firebase/firestore-service.js', () => ({
  FirestoreService: firestoreMocks,
}));
jest.unstable_mockModule('src/js/services/_firebase/firebase-service.js', () => ({
  getFirebaseApp: jest.fn(() => ({})),
}));
jest.unstable_mockModule('src/js/services/recipes/recipe-service.js', () => ({
  RecipeService: recipeServiceMocks,
}));
jest.unstable_mockModule('firebase/functions', () => ({
  getFunctions: jest.fn(() => ({})),
  httpsCallable: jest.fn(
    (_fns, name) =>
      (...args) =>
        callable(name, ...args),
  ),
}));

const at = (ms) => ({ toMillis: () => ms });

beforeEach(async () => {
  jest.resetModules();
  Object.values(firestoreMocks).forEach((m) => m.mockReset());
  recipeServiceMocks.get.mockReset();
  callable.mockReset();
  firestoreMocks.batchWrite.mockResolvedValue();
  firestoreMocks.deleteDocument.mockResolvedValue();
  ({ RecipeShareService } = await import('src/js/services/recipes/recipe-share-service.js'));
});

describe('RecipeShareService', () => {
  it('listFamily calls the function and returns its members', async () => {
    callable.mockResolvedValue({ data: { members: [{ uid: 'u1', name: 'דנה כהן' }] } });
    await expect(RecipeShareService.listFamily()).resolves.toEqual([
      { uid: 'u1', name: 'דנה כהן' },
    ]);
    expect(callable).toHaveBeenCalledWith('listFamilyMembers');
  });

  it('listForRecipe filters on the author and sorts newest first', async () => {
    firestoreMocks.queryDocuments.mockResolvedValue([
      { id: 'a', sharedAt: at(1) },
      { id: 'b', sharedAt: at(5) },
    ]);
    const shares = await RecipeShareService.listForRecipe('r1', 'me');
    expect(firestoreMocks.queryDocuments).toHaveBeenCalledWith('recipes/r1/shares', {
      where: [['authorId', '==', 'me']],
    });
    expect(shares.map((s) => s.id)).toEqual(['b', 'a']);
  });

  describe('share', () => {
    it('writes one record per recipient in a batch', async () => {
      await RecipeShareService.share('r1', {
        authorId: 'me',
        authorName: ' Roi Guri ',
        recipientUids: ['u1', 'u2', 'u1', 'me', ''],
      });
      const ops = firestoreMocks.batchWrite.mock.calls[0][0];
      expect(ops.map((op) => op.id)).toEqual(['u1', 'u2']);
      expect(ops[0]).toEqual({
        type: 'set',
        collection: 'recipes/r1/shares',
        id: 'u1',
        data: {
          recipientUid: 'u1',
          authorId: 'me',
          authorName: 'Roi Guri',
          sharedAt: 'server-timestamp',
        },
      });
    });

    it('does nothing without recipients and needs a name', async () => {
      await RecipeShareService.share('r1', { authorId: 'me', authorName: 'R', recipientUids: [] });
      expect(firestoreMocks.batchWrite).not.toHaveBeenCalled();
      await expect(
        RecipeShareService.share('r1', { authorId: 'me', authorName: ' ', recipientUids: ['u1'] }),
      ).rejects.toThrow('authorName');
    });
  });

  it('remove deletes the recipient’s record', async () => {
    await RecipeShareService.remove('r1', 'u1');
    expect(firestoreMocks.deleteDocument).toHaveBeenCalledWith('recipes/r1/shares', 'u1');
  });

  it('removeAll deletes every record and never throws', async () => {
    firestoreMocks.queryDocuments.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
    await RecipeShareService.removeAll('r1', 'me');
    expect(firestoreMocks.batchWrite.mock.calls[0][0].map((op) => op.type)).toEqual([
      'delete',
      'delete',
    ]);
    firestoreMocks.queryDocuments.mockRejectedValue(new Error('denied'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(RecipeShareService.removeAll('r1', 'me')).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('getMine returns null when not shared or not readable', async () => {
    firestoreMocks.getDocument.mockResolvedValueOnce({ id: 'me', authorName: 'R' });
    await expect(RecipeShareService.getMine('r1', 'me')).resolves.toEqual({
      id: 'me',
      authorName: 'R',
    });
    firestoreMocks.getDocument.mockRejectedValueOnce(new Error('denied'));
    await expect(RecipeShareService.getMine('r1', 'me')).resolves.toBeNull();
  });

  it('listSharedWithMe returns readable recipes with who shared them, newest first', async () => {
    firestoreMocks.queryCollectionGroup.mockResolvedValue([
      { parentId: 'old', authorId: 'a1', authorName: 'דנה כהן', sharedAt: at(1) },
      { parentId: 'new', authorId: 'a2', authorName: 'אבי לוי', sharedAt: at(9) },
      { parentId: 'gone', authorId: 'a1', authorName: 'דנה כהן', sharedAt: at(5) },
      { parentId: 'denied', authorId: 'a1', authorName: 'דנה כהן', sharedAt: at(6) },
    ]);
    recipeServiceMocks.get.mockImplementation(async (id) => {
      if (id === 'gone') return null;
      if (id === 'denied') throw new Error('permission-denied');
      return { id, name: id, authorId: 'a' };
    });
    const recipes = await RecipeShareService.listSharedWithMe('me');
    expect(firestoreMocks.queryCollectionGroup).toHaveBeenCalledWith('shares', {
      where: [['recipientUid', '==', 'me']],
    });
    expect(recipes.map((r) => r.id)).toEqual(['new', 'old']);
    expect(recipes[0].sharedBy).toEqual({ uid: 'a2', name: 'אבי לוי' });
  });
});
