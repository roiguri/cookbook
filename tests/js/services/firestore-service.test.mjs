import { jest } from '@jest/globals';
// Keep top-level mock imports to register jest.unstable_mockModule
import '../../common/mocks/firebase-firestore.mock.js';
import '../../common/mocks/firebase-service.mock.js';

let FirestoreService;
let firebaseServiceMocks;
let getDocs, addDoc, updateDoc, deleteDoc, writeBatch;
let firebaseService;

beforeEach(async () => {
  jest.clearAllMocks();
  ({ FirestoreService } = await import('src/js/services/_firebase/firestore-service.js'));
  ({ firebaseServiceMocks } = await import('../../common/mocks/firebase-service.mock.js'));
  ({ getDocs, addDoc, updateDoc, deleteDoc, writeBatch } = await import('firebase/firestore'));
  ({ firebaseService } = await import('../../common/mocks/firebase-firestore.mock.js'));
  firebaseService._mockUserDoc = firebaseServiceMocks.userDocMock;
});

describe('FirestoreService', () => {
  describe('getDocument', () => {
    it('returns document data if found', async () => {
      firebaseServiceMocks.userDocMock.exists = true;
      firebaseServiceMocks.userDocMock.data.mockReturnValue({ foo: 'bar' });
      firebaseServiceMocks.userDocMock.id = 'doc1';
      const doc = await FirestoreService.getDocument('users', 'doc1');
      expect(doc).toEqual({ id: 'doc1', foo: 'bar' });
    });
    it('returns null if document not found', async () => {
      firebaseServiceMocks.userDocMock.exists = false;
      const doc = await FirestoreService.getDocument('users', 'doc1');
      expect(doc).toBeNull();
    });
    it('throws on error', async () => {
      const orig = firebaseServiceMocks.userDocMock.data;
      firebaseServiceMocks.userDocMock.exists = true;
      firebaseServiceMocks.userDocMock.data = () => {
        throw new Error('fail');
      };
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await expect(FirestoreService.getDocument('users', 'doc1')).rejects.toThrow(
        'Failed to fetch document',
      );
      errorSpy.mockRestore();
      firebaseServiceMocks.userDocMock.data = orig;
    });
  });

  describe('queryDocuments', () => {
    it('returns array of documents', async () => {
      getDocs.mockResolvedValue({
        docs: [
          { id: 'a', data: () => ({ foo: 1 }) },
          { id: 'b', data: () => ({ foo: 2 }) },
        ],
      });
      const result = await FirestoreService.queryDocuments('users', {});
      expect(result).toEqual([
        { id: 'a', foo: 1 },
        { id: 'b', foo: 2 },
      ]);
    });
    it('throws on error', async () => {
      getDocs.mockRejectedValue(new Error('fail'));
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await expect(FirestoreService.queryDocuments('users', {})).rejects.toThrow(
        'Failed to query documents',
      );
      errorSpy.mockRestore();
    });
  });

  describe('addDocument', () => {
    it('returns new document id', async () => {
      addDoc.mockResolvedValue({ id: 'newid' });
      const id = await FirestoreService.addDocument('users', { foo: 'bar' });
      expect(id).toBe('newid');
    });
    it('throws on error', async () => {
      addDoc.mockRejectedValue(new Error('fail'));
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await expect(FirestoreService.addDocument('users', { foo: 'bar' })).rejects.toThrow(
        'Failed to add document',
      );
      errorSpy.mockRestore();
    });
  });

  describe('updateDocument', () => {
    it('calls updateDoc with correct args', async () => {
      updateDoc.mockResolvedValue();
      await expect(
        FirestoreService.updateDocument('users', 'id', { foo: 1 }),
      ).resolves.toBeUndefined();
      expect(updateDoc).toHaveBeenCalled();
    });
    it('throws on error', async () => {
      updateDoc.mockRejectedValue(new Error('fail'));
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await expect(FirestoreService.updateDocument('users', 'id', { foo: 1 })).rejects.toThrow(
        'Failed to update document',
      );
      errorSpy.mockRestore();
    });
  });

  describe('deleteDocument', () => {
    it('calls deleteDoc with correct args', async () => {
      deleteDoc.mockResolvedValue();
      await expect(FirestoreService.deleteDocument('users', 'id')).resolves.toBeUndefined();
      expect(deleteDoc).toHaveBeenCalled();
    });
    it('throws on error', async () => {
      deleteDoc.mockRejectedValue(new Error('fail'));
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await expect(FirestoreService.deleteDocument('users', 'id')).rejects.toThrow(
        'Failed to delete document',
      );
      errorSpy.mockRestore();
    });
  });

  describe('batchWrite', () => {
    it('commits batch with correct operations', async () => {
      const commit = jest.fn().mockResolvedValue();
      const set = jest.fn();
      const update = jest.fn();
      const del = jest.fn();
      writeBatch.mockReturnValue({ set, update, delete: del, commit });
      await expect(
        FirestoreService.batchWrite([
          { type: 'set', collection: 'users', id: '1', data: { foo: 1 } },
          { type: 'update', collection: 'users', id: '2', data: { foo: 2 } },
          { type: 'delete', collection: 'users', id: '3' },
        ]),
      ).resolves.toBeUndefined();
      expect(set).toHaveBeenCalled();
      expect(update).toHaveBeenCalled();
      expect(del).toHaveBeenCalled();
      expect(commit).toHaveBeenCalled();
    });
    it('throws on error', async () => {
      writeBatch.mockReturnValue({
        commit: jest.fn().mockRejectedValue(new Error('fail')),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      });
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await expect(
        FirestoreService.batchWrite([
          { type: 'set', collection: 'users', id: '1', data: { foo: 1 } },
        ]),
      ).rejects.toThrow('Failed to perform batch write');
      errorSpy.mockRestore();
    });
  });
});
