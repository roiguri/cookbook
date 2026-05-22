import { jest } from '@jest/globals';

import '../../common/mocks/firebase-firestore.mock.js';
import '../../common/mocks/firebase-service.mock.js';

let UserService;
let arrayUnion, arrayRemove;

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

  ({ UserService } = await import('src/js/services/users/user-service.js'));
  ({ arrayUnion, arrayRemove } = await import('firebase/firestore'));
});

describe('UserService', () => {
  describe('get', () => {
    it('delegates to FirestoreService.getDocument with the users collection', async () => {
      firestoreMocks.getDocument.mockResolvedValue({ id: 'u1', role: 'manager' });
      const result = await UserService.get('u1');
      expect(firestoreMocks.getDocument).toHaveBeenCalledWith('users', 'u1');
      expect(result).toEqual({ id: 'u1', role: 'manager' });
    });

    it('throws when uid is missing', async () => {
      await expect(UserService.get('')).rejects.toThrow('uid is required');
    });
  });

  describe('list', () => {
    it('delegates to FirestoreService.queryDocuments with the users collection', async () => {
      firestoreMocks.queryDocuments.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      const result = await UserService.list({ where: [['role', '==', 'manager']] });
      expect(firestoreMocks.queryDocuments).toHaveBeenCalledWith('users', {
        where: [['role', '==', 'manager']],
      });
      expect(result).toEqual([{ id: 'a' }, { id: 'b' }]);
    });

    it('passes an empty query object when no params given', async () => {
      firestoreMocks.queryDocuments.mockResolvedValue([]);
      await UserService.list();
      expect(firestoreMocks.queryDocuments).toHaveBeenCalledWith('users', {});
    });
  });

  describe('create', () => {
    it('delegates to FirestoreService.setDocument', async () => {
      firestoreMocks.setDocument.mockResolvedValue();
      const data = { displayName: 'Ada', role: 'user', favorites: [] };
      await UserService.create('u1', data);
      expect(firestoreMocks.setDocument).toHaveBeenCalledWith('users', 'u1', data);
    });

    it('throws when uid is missing', async () => {
      await expect(UserService.create('', { role: 'user' })).rejects.toThrow('uid is required');
    });

    it('throws when data is missing or not an object', async () => {
      await expect(UserService.create('u1', null)).rejects.toThrow('data is required');
      await expect(UserService.create('u1', 'not-an-object')).rejects.toThrow('data is required');
    });
  });

  describe('update', () => {
    it('delegates to FirestoreService.updateDocument', async () => {
      firestoreMocks.updateDocument.mockResolvedValue();
      await UserService.update('u1', { role: 'manager' });
      expect(firestoreMocks.updateDocument).toHaveBeenCalledWith('users', 'u1', {
        role: 'manager',
      });
    });

    it('throws when uid is missing', async () => {
      await expect(UserService.update('', { role: 'manager' })).rejects.toThrow('uid is required');
    });

    it('throws when changes is missing or not an object', async () => {
      await expect(UserService.update('u1', null)).rejects.toThrow('changes is required');
    });
  });

  describe('delete', () => {
    it('delegates to FirestoreService.deleteDocument', async () => {
      firestoreMocks.deleteDocument.mockResolvedValue();
      await UserService.delete('u1');
      expect(firestoreMocks.deleteDocument).toHaveBeenCalledWith('users', 'u1');
    });

    it('throws when uid is missing', async () => {
      await expect(UserService.delete('')).rejects.toThrow('uid is required');
    });
  });

  describe('addToArrayField', () => {
    it('calls updateDocument with an arrayUnion sentinel for the requested field', async () => {
      firestoreMocks.updateDocument.mockResolvedValue();
      await UserService.addToArrayField('u1', 'favorites', 'recipe-7');
      // arrayUnion(value) produces an opaque FieldValue sentinel. We check
      // that it was wrapped in arrayUnion by comparing to a fresh call.
      const expectedSentinel = arrayUnion('recipe-7');
      expect(firestoreMocks.updateDocument).toHaveBeenCalledWith('users', 'u1', {
        favorites: expectedSentinel,
      });
    });

    it('throws when uid or field is missing', async () => {
      await expect(UserService.addToArrayField('', 'favorites', 'x')).rejects.toThrow(
        'uid is required',
      );
      await expect(UserService.addToArrayField('u1', '', 'x')).rejects.toThrow('field is required');
    });
  });

  describe('removeFromArrayField', () => {
    it('calls updateDocument with an arrayRemove sentinel for the requested field', async () => {
      firestoreMocks.updateDocument.mockResolvedValue();
      await UserService.removeFromArrayField('u1', 'fcmTokens', 'token-abc');
      const expectedSentinel = arrayRemove('token-abc');
      expect(firestoreMocks.updateDocument).toHaveBeenCalledWith('users', 'u1', {
        fcmTokens: expectedSentinel,
      });
    });

    it('throws when uid or field is missing', async () => {
      await expect(UserService.removeFromArrayField('', 'fcmTokens', 'x')).rejects.toThrow(
        'uid is required',
      );
      await expect(UserService.removeFromArrayField('u1', '', 'x')).rejects.toThrow(
        'field is required',
      );
    });
  });
});
