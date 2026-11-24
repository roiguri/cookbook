import { deleteDocument, listDocuments, orderBy } from '../_firebase/firestore-adapter';
import { captureError } from '../logger';

const FAILED_URL_EXTRACTIONS_COLLECTION = 'failed_url_extractions';

export interface FailedUrlExtractionError {
  message?: string;
  stack?: string;
  code?: string;
  [key: string]: any;
}

export interface FailedUrlExtractionDoc {
  id: string;
  url: string;
  count: number;
  kind?: 'url' | 'video' | string;
  firstAttempt?: any;
  lastAttempt?: any;
  lastUserId?: string;
  error?: FailedUrlExtractionError;
}

function timestampMillis(value: any): number {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * FailedUrlExtractionService — Single owner of `failed_url_extractions` (manager only).
 * Populated server-side by `extractRecipeFromUrl` / `extractRecipeFromVideo`.
 */
export const FailedUrlExtractionService = {
  /**
   * List all failed URL extraction records, most recent first (`lastAttempt desc`).
   */
  async list(): Promise<FailedUrlExtractionDoc[]> {
    try {
      return await listDocuments<FailedUrlExtractionDoc>(FAILED_URL_EXTRACTIONS_COLLECTION, [
        orderBy('lastAttempt', 'desc'),
      ]);
    } catch (err) {
      // Fallback if any legacy/seeded doc lacks an indexed `lastAttempt` field
      try {
        const docs = await listDocuments<FailedUrlExtractionDoc>(FAILED_URL_EXTRACTIONS_COLLECTION);
        return [...docs].sort(
          (a, b) => timestampMillis(b.lastAttempt) - timestampMillis(a.lastAttempt),
        );
      } catch (fallbackErr) {
        captureError(fallbackErr, { service: 'failed-url-extraction', op: 'list' });
        throw fallbackErr;
      }
    }
  },

  /**
   * Delete a single failed URL extraction record by document ID.
   */
  async delete(id: string): Promise<void> {
    if (!id || !id.trim()) {
      throw new Error('FailedUrlExtractionService.delete: id is required');
    }
    try {
      await deleteDocument(FAILED_URL_EXTRACTIONS_COLLECTION, id);
    } catch (err) {
      captureError(err, { service: 'failed-url-extraction', op: 'delete', recordId: id });
      throw err;
    }
  },
};

export const failedUrlExtractionService = FailedUrlExtractionService;
