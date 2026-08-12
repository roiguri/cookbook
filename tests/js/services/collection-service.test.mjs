import { jest } from '@jest/globals';

import '../../common/mocks/firebase-firestore.mock.js';
import '../../common/mocks/firebase-service.mock.js';

let CollectionService;

const firestoreMocks = {
  getDocument: jest.fn(),
  queryDocuments: jest.fn(),
  setDocument: jest.fn(),
  updateDocument: jest.fn(),
  deleteDocument: jest.fn(),
};

jest.unstable_mockModule('src/js/services/_firebase/firestore-service.js', () => ({
  FirestoreService: firestoreMocks,
}));

beforeEach(async () => {
  jest.resetModules();
  Object.values(firestoreMocks).forEach((m) => m.mockReset());

  ({ CollectionService } = await import('src/js/services/users/collection-service.js'));
});

describe('CollectionService', () => {
  describe('get', () => {
    it('delegates to FirestoreService.getDocument with the user collection subpath', async () => {
      firestoreMocks.getDocument.mockResolvedValue({ id: 'r1', source: 'saved', state: 'to-try' });
      const result = await CollectionService.get('u1', 'r1');
      expect(firestoreMocks.getDocument).toHaveBeenCalledWith('users/u1/collection', 'r1');
      expect(result).toEqual({ id: 'r1', source: 'saved', state: 'to-try' });
    });

    it('throws when uid or recipeId is missing', async () => {
      await expect(CollectionService.get('', 'r1')).rejects.toThrow('uid is required');
      await expect(CollectionService.get('u1', '')).rejects.toThrow('recipeId is required');
    });
  });

  describe('list', () => {
    it('queries the user collection subpath with no filters by default', async () => {
      firestoreMocks.queryDocuments.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      const result = await CollectionService.list('u1');
      expect(firestoreMocks.queryDocuments).toHaveBeenCalledWith('users/u1/collection', {});
      expect(result).toEqual([{ id: 'a' }, { id: 'b' }]);
    });

    it('filters by state when provided', async () => {
      firestoreMocks.queryDocuments.mockResolvedValue([{ id: 'a', state: 'rotation' }]);
      const result = await CollectionService.list('u1', { state: 'rotation' });
      expect(firestoreMocks.queryDocuments).toHaveBeenCalledWith('users/u1/collection', {
        where: [['state', '==', 'rotation']],
      });
      expect(result).toEqual([{ id: 'a', state: 'rotation' }]);
    });

    it('throws on an invalid state filter', async () => {
      await expect(CollectionService.list('u1', { state: 'bogus' })).rejects.toThrow(
        'invalid state',
      );
    });

    it('throws when uid is missing', async () => {
      await expect(CollectionService.list('')).rejects.toThrow('uid is required');
    });
  });

  describe('create', () => {
    it('creates a new entry defaulting state to to-try and stamping addedAt', async () => {
      firestoreMocks.getDocument.mockResolvedValue(null);
      firestoreMocks.setDocument.mockResolvedValue();

      const result = await CollectionService.create('u1', 'r1', { source: 'saved' });

      expect(firestoreMocks.getDocument).toHaveBeenCalledWith('users/u1/collection', 'r1');
      expect(firestoreMocks.setDocument).toHaveBeenCalledWith('users/u1/collection', 'r1', {
        source: 'saved',
        state: 'to-try',
        addedAt: 'mock-timestamp-now',
      });
      expect(result).toMatchObject({ id: 'r1', source: 'saved', state: 'to-try' });
    });

    it('accepts an explicit state (e.g. rotation for the favorites migration)', async () => {
      firestoreMocks.getDocument.mockResolvedValue(null);
      firestoreMocks.setDocument.mockResolvedValue();

      await CollectionService.create('u1', 'r1', { source: 'saved', state: 'rotation' });

      expect(firestoreMocks.setDocument).toHaveBeenCalledWith(
        'users/u1/collection',
        'r1',
        expect.objectContaining({ state: 'rotation' }),
      );
    });

    it('includes optional notes, servingsOverride, and card when provided', async () => {
      firestoreMocks.getDocument.mockResolvedValue(null);
      firestoreMocks.setDocument.mockResolvedValue();

      const card = { name: 'Soup', category: 'Mains', primaryImage: 'img.jpg', prepTime: 30 };
      await CollectionService.create('u1', 'r1', {
        source: 'owned',
        notes: 'less salt',
        servingsOverride: 2,
        card,
      });

      expect(firestoreMocks.setDocument).toHaveBeenCalledWith(
        'users/u1/collection',
        'r1',
        expect.objectContaining({ notes: 'less salt', servingsOverride: 2, card }),
      );
    });

    it('is create-only: no-ops and returns the existing entry without writing', async () => {
      const existing = { id: 'r1', source: 'saved', state: 'rotation', notes: 'keep me' };
      firestoreMocks.getDocument.mockResolvedValue(existing);

      const result = await CollectionService.create('u1', 'r1', { source: 'saved' });

      expect(firestoreMocks.setDocument).not.toHaveBeenCalled();
      expect(result).toEqual(existing);
    });

    it('throws on an invalid source', async () => {
      await expect(CollectionService.create('u1', 'r1', { source: 'bogus' })).rejects.toThrow(
        'invalid source',
      );
      expect(firestoreMocks.getDocument).not.toHaveBeenCalled();
    });

    it('throws on an invalid state', async () => {
      await expect(
        CollectionService.create('u1', 'r1', { source: 'saved', state: 'bogus' }),
      ).rejects.toThrow('invalid state');
    });

    it('throws when uid, recipeId, or entry is missing', async () => {
      await expect(CollectionService.create('', 'r1', { source: 'saved' })).rejects.toThrow(
        'uid is required',
      );
      await expect(CollectionService.create('u1', '', { source: 'saved' })).rejects.toThrow(
        'recipeId is required',
      );
      await expect(CollectionService.create('u1', 'r1', null)).rejects.toThrow('entry is required');
    });
  });

  describe('update', () => {
    it('delegates to FirestoreService.updateDocument', async () => {
      firestoreMocks.updateDocument.mockResolvedValue();
      await CollectionService.update('u1', 'r1', { notes: 'updated' });
      expect(firestoreMocks.updateDocument).toHaveBeenCalledWith('users/u1/collection', 'r1', {
        notes: 'updated',
      });
    });

    it('rejects patches that try to change source', async () => {
      await expect(CollectionService.update('u1', 'r1', { source: 'owned' })).rejects.toThrow(
        'source cannot be changed',
      );
      expect(firestoreMocks.updateDocument).not.toHaveBeenCalled();
    });

    it('rejects an invalid state in the patch', async () => {
      await expect(CollectionService.update('u1', 'r1', { state: 'bogus' })).rejects.toThrow(
        'invalid state',
      );
    });

    it('throws when uid, recipeId, or patch is missing', async () => {
      await expect(CollectionService.update('', 'r1', {})).rejects.toThrow('uid is required');
      await expect(CollectionService.update('u1', '', {})).rejects.toThrow('recipeId is required');
      await expect(CollectionService.update('u1', 'r1', null)).rejects.toThrow('patch is required');
    });
  });

  describe('delete', () => {
    it('delegates to FirestoreService.deleteDocument', async () => {
      firestoreMocks.deleteDocument.mockResolvedValue();
      await CollectionService.delete('u1', 'r1');
      expect(firestoreMocks.deleteDocument).toHaveBeenCalledWith('users/u1/collection', 'r1');
    });

    it('throws when uid or recipeId is missing', async () => {
      await expect(CollectionService.delete('', 'r1')).rejects.toThrow('uid is required');
      await expect(CollectionService.delete('u1', '')).rejects.toThrow('recipeId is required');
    });
  });

  describe('setState', () => {
    it('updates only the state field', async () => {
      firestoreMocks.updateDocument.mockResolvedValue();
      await CollectionService.setState('u1', 'r1', 'rotation');
      expect(firestoreMocks.updateDocument).toHaveBeenCalledWith('users/u1/collection', 'r1', {
        state: 'rotation',
      });
    });

    it('throws on an invalid state', async () => {
      await expect(CollectionService.setState('u1', 'r1', 'bogus')).rejects.toThrow(
        'invalid state',
      );
      expect(firestoreMocks.updateDocument).not.toHaveBeenCalled();
    });
  });

  describe('updateOverlay', () => {
    it('patches only notes when servingsOverride is absent', async () => {
      firestoreMocks.updateDocument.mockResolvedValue();
      await CollectionService.updateOverlay('u1', 'r1', { notes: 'less sugar' });
      expect(firestoreMocks.updateDocument).toHaveBeenCalledWith('users/u1/collection', 'r1', {
        notes: 'less sugar',
      });
    });

    it('patches only servingsOverride when notes is absent', async () => {
      firestoreMocks.updateDocument.mockResolvedValue();
      await CollectionService.updateOverlay('u1', 'r1', { servingsOverride: 4 });
      expect(firestoreMocks.updateDocument).toHaveBeenCalledWith('users/u1/collection', 'r1', {
        servingsOverride: 4,
      });
    });

    it('patches both when both are provided', async () => {
      firestoreMocks.updateDocument.mockResolvedValue();
      await CollectionService.updateOverlay('u1', 'r1', { notes: 'x', servingsOverride: 4 });
      expect(firestoreMocks.updateDocument).toHaveBeenCalledWith('users/u1/collection', 'r1', {
        notes: 'x',
        servingsOverride: 4,
      });
    });

    it('allows explicitly clearing notes with null', async () => {
      firestoreMocks.updateDocument.mockResolvedValue();
      await CollectionService.updateOverlay('u1', 'r1', { notes: null });
      expect(firestoreMocks.updateDocument).toHaveBeenCalledWith('users/u1/collection', 'r1', {
        notes: null,
      });
    });

    it('throws when neither notes nor servingsOverride is provided', async () => {
      await expect(CollectionService.updateOverlay('u1', 'r1', {})).rejects.toThrow(
        'at least one of notes or servingsOverride is required',
      );
      expect(firestoreMocks.updateDocument).not.toHaveBeenCalled();
    });
  });
});
