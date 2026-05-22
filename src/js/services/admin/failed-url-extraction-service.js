// src/js/services/admin/failed-url-extraction-service.js

import { FirestoreService } from '../_firebase/firestore-service.js';

const FAILED_URL_EXTRACTIONS_COLLECTION = 'failed_url_extractions';

/**
 * FailedUrlExtractionService — The Single Owner of `failed_url_extractions`
 *
 * Owns frontend access to the `failed_url_extractions` collection. The
 * collection itself is populated server-side by Cloud Functions when a
 * recipe URL extraction fails (see `functions/index.js`); this service
 * only handles the manager-dashboard read + delete surface.
 *
 * Public API:
 *   - list() — most-recent first, by `lastAttempt` desc.
 *   - delete(id)
 */
export class FailedUrlExtractionService {
  /**
   * List all failed URL extraction records, most recent first.
   *
   * @returns {Promise<Array<Object>>}
   */
  static async list() {
    return FirestoreService.queryDocuments(FAILED_URL_EXTRACTIONS_COLLECTION, {
      orderBy: ['lastAttempt', 'desc'],
    });
  }

  /**
   * Delete a single failed URL extraction record by ID.
   *
   * @param {string} id
   * @returns {Promise<void>}
   */
  static async delete(id) {
    if (!id) {
      throw new Error('FailedUrlExtractionService.delete: id is required');
    }
    return FirestoreService.deleteDocument(FAILED_URL_EXTRACTIONS_COLLECTION, id);
  }
}

export const failedUrlExtractionService = FailedUrlExtractionService;
