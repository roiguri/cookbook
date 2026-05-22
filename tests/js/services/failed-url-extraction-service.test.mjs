import { jest } from '@jest/globals';

import '../../common/mocks/firebase-firestore.mock.js';
import '../../common/mocks/firebase-service.mock.js';

let FailedUrlExtractionService;

const firestoreMocks = {
  queryDocuments: jest.fn(),
  deleteDocument: jest.fn(),
};

jest.unstable_mockModule('src/js/services/_firebase/firestore-service.js', () => ({
  FirestoreService: firestoreMocks,
}));

beforeEach(async () => {
  jest.resetModules();
  Object.values(firestoreMocks).forEach((m) => m.mockReset());
  firestoreMocks.deleteDocument.mockResolvedValue();

  ({ FailedUrlExtractionService } = await import(
    'src/js/services/admin/failed-url-extraction-service.js'
  ));
});

describe('FailedUrlExtractionService.list', () => {
  it('queries the failed_url_extractions collection ordered by lastAttempt desc', async () => {
    firestoreMocks.queryDocuments.mockResolvedValue([
      { id: 'a', url: 'https://example.com/1', lastAttempt: 100 },
      { id: 'b', url: 'https://example.com/2', lastAttempt: 50 },
    ]);

    const result = await FailedUrlExtractionService.list();

    expect(firestoreMocks.queryDocuments).toHaveBeenCalledTimes(1);
    const [collection, params] = firestoreMocks.queryDocuments.mock.calls[0];
    expect(collection).toBe('failed_url_extractions');
    expect(params).toEqual({ orderBy: ['lastAttempt', 'desc'] });
    expect(result).toEqual([
      { id: 'a', url: 'https://example.com/1', lastAttempt: 100 },
      { id: 'b', url: 'https://example.com/2', lastAttempt: 50 },
    ]);
  });

  it('returns an empty array when no records exist', async () => {
    firestoreMocks.queryDocuments.mockResolvedValue([]);
    expect(await FailedUrlExtractionService.list()).toEqual([]);
  });

  it('propagates Firestore errors', async () => {
    firestoreMocks.queryDocuments.mockRejectedValue(new Error('boom'));
    await expect(FailedUrlExtractionService.list()).rejects.toThrow('boom');
  });
});

describe('FailedUrlExtractionService.delete', () => {
  it('throws when id is missing', async () => {
    await expect(FailedUrlExtractionService.delete('')).rejects.toThrow('id is required');
    await expect(FailedUrlExtractionService.delete(undefined)).rejects.toThrow('id is required');
    expect(firestoreMocks.deleteDocument).not.toHaveBeenCalled();
  });

  it('delegates to FirestoreService.deleteDocument on the right collection + id', async () => {
    await FailedUrlExtractionService.delete('record-123');
    expect(firestoreMocks.deleteDocument).toHaveBeenCalledTimes(1);
    expect(firestoreMocks.deleteDocument).toHaveBeenCalledWith(
      'failed_url_extractions',
      'record-123',
    );
  });

  it('propagates Firestore errors', async () => {
    firestoreMocks.deleteDocument.mockRejectedValue(new Error('nope'));
    await expect(FailedUrlExtractionService.delete('record-123')).rejects.toThrow('nope');
  });
});
