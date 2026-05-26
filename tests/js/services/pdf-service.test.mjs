import { jest } from '@jest/globals';

import '../../common/mocks/firebase-firestore.mock.js';
import '../../common/mocks/firebase-storage.mock.js';
import '../../common/mocks/firebase-service.mock.js';

let PdfService;

const firestoreMocks = {
  getDocument: jest.fn(),
};

const storageMocks = {
  getFileUrl: jest.fn(),
};

jest.unstable_mockModule('src/js/services/_firebase/firestore-service.js', () => ({
  FirestoreService: firestoreMocks,
}));
jest.unstable_mockModule('src/js/services/_firebase/storage-service.js', () => ({
  StorageService: storageMocks,
}));

beforeEach(async () => {
  jest.resetModules();
  Object.values(firestoreMocks).forEach((m) => m.mockReset?.());
  Object.values(storageMocks).forEach((m) => m.mockReset?.());
  ({ PdfService } = await import('src/js/services/pdf/pdf-service.js'));
});

describe('PdfService', () => {
  describe('getPageIndex', () => {
    it('returns the manifest document data when present', async () => {
      const manifest = { categories: { desserts: { pages: [12, 13] } } };
      firestoreMocks.getDocument.mockResolvedValueOnce(manifest);

      const result = await PdfService.getPageIndex('grandmas_cookbook', 'page-index');

      expect(firestoreMocks.getDocument).toHaveBeenCalledWith('grandmas_cookbook', 'page-index');
      expect(result).toBe(manifest);
    });

    it('returns null when the manifest doc is missing', async () => {
      firestoreMocks.getDocument.mockResolvedValueOnce(null);
      await expect(PdfService.getPageIndex('grandmas_cookbook', 'missing')).resolves.toBeNull();
    });

    it('throws when collection or fileName is missing', async () => {
      await expect(PdfService.getPageIndex('', 'file')).rejects.toThrow(
        'collection and fileName are required',
      );
      await expect(PdfService.getPageIndex('col', '')).rejects.toThrow(
        'collection and fileName are required',
      );
      expect(firestoreMocks.getDocument).not.toHaveBeenCalled();
    });

    it('propagates Firestore errors', async () => {
      firestoreMocks.getDocument.mockRejectedValueOnce(new Error('permission denied'));
      await expect(PdfService.getPageIndex('col', 'file')).rejects.toThrow('permission denied');
    });
  });

  describe('getPageImageUrl', () => {
    it('returns the Storage download URL for the given path', async () => {
      storageMocks.getFileUrl.mockResolvedValueOnce('https://storage/page.42.jpg');
      const result = await PdfService.getPageImageUrl('grandmas_cookbook/original/page.42.jpg');
      expect(storageMocks.getFileUrl).toHaveBeenCalledWith(
        'grandmas_cookbook/original/page.42.jpg',
      );
      expect(result).toBe('https://storage/page.42.jpg');
    });

    it('throws when path is missing', async () => {
      await expect(PdfService.getPageImageUrl('')).rejects.toThrow('path is required');
      await expect(PdfService.getPageImageUrl(null)).rejects.toThrow('path is required');
      expect(storageMocks.getFileUrl).not.toHaveBeenCalled();
    });

    it('propagates Storage errors', async () => {
      storageMocks.getFileUrl.mockRejectedValueOnce(new Error('not found'));
      await expect(PdfService.getPageImageUrl('p')).rejects.toThrow('not found');
    });
  });
});
