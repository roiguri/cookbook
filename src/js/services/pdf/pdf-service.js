// src/js/services/pdf/pdf-service.js

import { FirestoreService } from '../_firebase/firestore-service.js';
import { StorageService } from '../_firebase/storage-service.js';

/**
 * PdfService — Scanned-PDF Reads
 *
 * Thin domain wrapper for the grandma's-cookbook page-image PDF viewer
 * (and any future scanned-PDF features). Centralizes the Firestore
 * page-index read and the Storage page-image URL resolution so lib
 * components don't import `_firebase/*` services directly.
 *
 * Public API:
 *   - getPageIndex(collection, fileName)
 *   - getPageImageUrl(path)
 */
export class PdfService {
  /**
   * Fetch a scanned PDF's page-index manifest (typically maps
   * recipe ids / category labels to page numbers).
   *
   * @param {string} collection - Firestore collection holding the manifest.
   * @param {string} fileName - Document id within that collection.
   * @returns {Promise<Object|null>} Manifest data, or null when missing.
   */
  static async getPageIndex(collection, fileName) {
    if (!collection || !fileName) {
      throw new Error('PdfService.getPageIndex: collection and fileName are required');
    }
    return await FirestoreService.getDocument(collection, fileName);
  }

  /**
   * Resolve a download URL for a scanned-PDF page image stored in
   * Firebase Storage (e.g. `grandmas_cookbook/original/page.42.jpg`).
   *
   * @param {string} path - Storage path of the page image.
   * @returns {Promise<string>}
   */
  static async getPageImageUrl(path) {
    if (!path) {
      throw new Error('PdfService.getPageImageUrl: path is required');
    }
    return await StorageService.getFileUrl(path);
  }
}

export const pdfService = PdfService;
