// src/js/services/storage-service.js

// 1. External dependencies
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  listAll,
  getMetadata,
} from 'firebase/storage';
// 2. Internal modules/services
import { getStorageInstance } from './firebase-service.js';
import { captureError } from '../logger.js';
import { LRUCache } from '../../utils/lru-cache.js';

const urlCache = new LRUCache(500);

/**
 * StorageService: General-purpose file upload, retrieval, and deletion using Firebase Storage.
 */
export class StorageService {
  /**
   * Uploads a file to Firebase Storage.
   * @param {File|Blob} file - The file to upload
   * @param {string} path - The storage path (e.g. 'uploads/myfile.txt')
   * @returns {Promise<string>} The download URL of the uploaded file
   */
  static async uploadFile(file, path) {
    try {
      const storage = getStorageInstance();
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      urlCache.set(path, url);
      return url;
    } catch (error) {
      console.error('Error uploading file:', error);
      captureError(error, {
        service: 'storage',
        op: 'uploadFile',
        path,
        size: file?.size,
        type: file?.type,
      });
      throw new Error('Failed to upload file');
    }
  }

  /**
   * Gets the download URL for a file in Firebase Storage.
   * @param {string} path - The storage path
   * @param {Object} [options]
   * @param {boolean} [options.quietOn404=false] - When true, `storage/object-not-found`
   *   errors skip console.error + Sentry capture (the error still throws so caller
   *   fallback chains run). Use only at sites that explicitly expect the miss —
   *   e.g. read-with-fallback during resize-extension lag (#189).
   * @returns {Promise<string>} The download URL
   */
  static async getFileUrl(path, { quietOn404 = false } = {}) {
    if (urlCache.has(path)) {
      return urlCache.get(path);
    }

    try {
      const storage = getStorageInstance();
      const storageRef = ref(storage, path);
      const url = await getDownloadURL(storageRef);
      urlCache.set(path, url);
      return url;
    } catch (error) {
      if (!(quietOn404 && error?.code === 'storage/object-not-found')) {
        console.error('Error getting file URL:', error);
        captureError(error, { service: 'storage', op: 'getFileUrl', path });
      }
      throw new Error('Failed to get file URL');
    }
  }

  /**
   * Deletes a file from Firebase Storage.
   * @param {string} path - The storage path
   * @returns {Promise<void>}
   */
  static async deleteFile(path) {
    try {
      const storage = getStorageInstance();
      const storageRef = ref(storage, path);
      await deleteObject(storageRef);
      urlCache.delete(path);
    } catch (error) {
      console.error('Error deleting file:', error);
      captureError(error, { service: 'storage', op: 'deleteFile', path });
      throw new Error('Failed to delete file');
    }
  }

  /**
   * Lists all files and folders under a given storage path.
   * @param {string} path - The storage path (e.g. 'uploads/')
   * @returns {Promise<{ items: Array, prefixes: Array }>} List of file and folder references
   */
  static async listFiles(path) {
    try {
      const storage = getStorageInstance();
      const storageRef = ref(storage, path);
      const result = await listAll(storageRef);
      return {
        items: result.items, // Array of StorageReference for files
        prefixes: result.prefixes, // Array of StorageReference for folders
      };
    } catch (error) {
      console.error('Error listing files:', error);
      captureError(error, { service: 'storage', op: 'listFiles', path });
      throw new Error('Failed to list files');
    }
  }

  /**
   * Gets the metadata for a file in Firebase Storage.
   * @param {string} path - The storage path
   * @param {Object} [options]
   * @param {boolean} [options.quietOn404=false] - When true, `storage/object-not-found`
   *   errors skip console.error + Sentry capture (the error still throws). Use at
   *   sites that use this as an existence probe and treat the miss as expected.
   * @returns {Promise<Object>} The file metadata
   */
  static async getMetadata(path, { quietOn404 = false } = {}) {
    try {
      const storage = getStorageInstance();
      const storageRef = ref(storage, path);
      return await getMetadata(storageRef);
    } catch (error) {
      if (!(quietOn404 && error?.code === 'storage/object-not-found')) {
        console.error('Error getting file metadata:', error);
        captureError(error, { service: 'storage', op: 'getMetadata', path });
      }
      throw new Error('Failed to get file metadata');
    }
  }
}

// Optionally, export a singleton instance
export const storageService = StorageService;
