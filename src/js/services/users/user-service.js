// src/js/services/users/user-service.js

import { arrayUnion, arrayRemove } from 'firebase/firestore';
import { FirestoreService } from '../_firebase/firestore-service.js';
import { StorageService } from '../_firebase/storage-service.js';

const USERS_COLLECTION = 'users';
const AVATAR_OPTIONS_PATH = 'Avatars';

/**
 * UserService — The Single Owner of `users/{uid}`
 *
 * Public entry point for all reads and writes against the users
 * collection. Field-scoped services (FavoritesService,
 * NotificationService) compose on top — they delegate user-doc access
 * here instead of touching the doc directly.
 *
 * AuthService owns Firebase Auth state ("who is signed in"); it does
 * NOT own the users doc. After Phase 2 caller migrations, AuthService
 * will read/write the users doc through UserService.
 *
 * Public API:
 *   - get(uid)
 *   - list(queryParams)
 *   - create(uid, data)
 *   - update(uid, changes)
 *   - delete(uid)
 *   - addToArrayField(uid, field, value)
 *   - removeFromArrayField(uid, field, value)
 *   - listAvatarOptions()
 *
 * The array helpers wrap Firestore's `arrayUnion` / `arrayRemove`
 * sentinels so domain services never need to import
 * `firebase/firestore` directly.
 */
export class UserService {
  /**
   * Fetch a single user doc by uid. Returns null when not found.
   * @param {string} uid
   * @returns {Promise<Object|null>}
   */
  static async get(uid) {
    if (!uid) throw new Error('UserService.get: uid is required');
    return await FirestoreService.getDocument(USERS_COLLECTION, uid);
  }

  /**
   * Query users with the same shape as FirestoreService.queryDocuments.
   * @param {Object} [queryParams]
   * @returns {Promise<Array<Object>>}
   */
  static async list(queryParams = {}) {
    return await FirestoreService.queryDocuments(USERS_COLLECTION, queryParams);
  }

  /**
   * Create a new user doc at `users/{uid}` with the given data. Last
   * writer wins — calling this on an existing uid overwrites the doc.
   * Caller is responsible for the doc shape.
   *
   * @param {string} uid
   * @param {Object} data
   * @returns {Promise<void>}
   */
  static async create(uid, data) {
    if (!uid) throw new Error('UserService.create: uid is required');
    if (!data || typeof data !== 'object') {
      throw new Error('UserService.create: data is required');
    }
    return await FirestoreService.setDocument(USERS_COLLECTION, uid, data);
  }

  /**
   * Patch fields on an existing user doc. Firestore's underlying
   * updateDoc semantics are field-merge — only the keys you pass are
   * touched; other fields are left alone.
   *
   * For atomic array operations, prefer `addToArrayField` /
   * `removeFromArrayField` over passing array values directly.
   *
   * @param {string} uid
   * @param {Object} changes - Field changes to apply.
   * @returns {Promise<void>}
   */
  static async update(uid, changes) {
    if (!uid) throw new Error('UserService.update: uid is required');
    if (!changes || typeof changes !== 'object') {
      throw new Error('UserService.update: changes is required');
    }
    return await FirestoreService.updateDocument(USERS_COLLECTION, uid, changes);
  }

  /**
   * Delete a user doc.
   * @param {string} uid
   * @returns {Promise<void>}
   */
  static async delete(uid) {
    if (!uid) throw new Error('UserService.delete: uid is required');
    return await FirestoreService.deleteDocument(USERS_COLLECTION, uid);
  }

  /**
   * Atomically add a value to an array field on the user doc. Wraps
   * Firestore's `arrayUnion` sentinel so domain callers don't need to
   * import the Firestore SDK. Idempotent — adding a value that's
   * already in the array is a no-op.
   *
   * @param {string} uid
   * @param {string} field - Name of the array field (e.g. 'favorites', 'fcmTokens').
   * @param {*} value - Value to add.
   * @returns {Promise<void>}
   */
  static async addToArrayField(uid, field, value) {
    if (!uid) throw new Error('UserService.addToArrayField: uid is required');
    if (!field) throw new Error('UserService.addToArrayField: field is required');
    return await FirestoreService.updateDocument(USERS_COLLECTION, uid, {
      [field]: arrayUnion(value),
    });
  }

  /**
   * Atomically remove a value from an array field on the user doc.
   * Wraps Firestore's `arrayRemove` sentinel. No-op when the value
   * isn't present.
   *
   * @param {string} uid
   * @param {string} field
   * @param {*} value
   * @returns {Promise<void>}
   */
  static async removeFromArrayField(uid, field, value) {
    if (!uid) throw new Error('UserService.removeFromArrayField: uid is required');
    if (!field) throw new Error('UserService.removeFromArrayField: field is required');
    return await FirestoreService.updateDocument(USERS_COLLECTION, uid, {
      [field]: arrayRemove(value),
    });
  }

  /**
   * List the stock avatar options users can pick from the profile UI.
   * Each entry is a resolved download URL. Static fixtures stored under
   * the `Avatars/` Storage prefix.
   *
   * @returns {Promise<string[]>}
   */
  static async listAvatarOptions() {
    const list = await StorageService.listFiles(AVATAR_OPTIONS_PATH);
    return Promise.all(list.items.map((ref) => StorageService.getFileUrl(ref.fullPath)));
  }
}

export const userService = UserService;
