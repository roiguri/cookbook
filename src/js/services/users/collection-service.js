// src/js/services/users/collection-service.js

import { Timestamp } from 'firebase/firestore';
import { FirestoreService } from '../_firebase/firestore-service.js';

const VALID_SOURCES = ['owned', 'saved'];
const VALID_STATES = ['to-try', 'rotation'];
const DEFAULT_STATE = 'to-try';

/**
 * CollectionService — The Single Owner of `users/{uid}/collection/{recipeId}`
 *
 * Public entry point for all reads and writes against a user's personal
 * recipe collection — the per-user overlay described in
 * docs/feature-plans/personal-collections.md ("The core model"). The
 * subcollection doc ID equals the recipe ID, which is what makes `create`
 * idempotent-by-construction: "is this recipe in my collection?" is a
 * single `get`, never a query.
 *
 * Entry schema:
 *   - source: 'owned' | 'saved'        — provenance, set once at create, never changed
 *   - state:  'to-try' | 'rotation'     — cooking lifecycle, exclusive
 *   - addedAt: Timestamp
 *   - notes?: string
 *   - servingsOverride?: number
 *   - card?: { name, category, primaryImage, prepTime }  — denormalised render data
 *
 * Public API:
 *   - get(uid, recipeId)
 *   - list(uid, filters?)
 *   - create(uid, recipeId, entry)      — create-only: no-ops if the entry already exists
 *   - update(uid, recipeId, patch)
 *   - delete(uid, recipeId)
 *   - setState(uid, recipeId, state)
 *   - updateOverlay(uid, recipeId, { notes, servingsOverride })
 */
export class CollectionService {
  /**
   * Build the Firestore path to a user's collection subcollection. Passed
   * straight through to FirestoreService — the Firestore SDK treats a
   * slash-separated path identically whether it names a top-level
   * collection or a subcollection, so no infrastructure change is needed.
   * @param {string} uid
   * @returns {string}
   */
  static _collectionPath(uid) {
    return `users/${uid}/collection`;
  }

  /**
   * Fetch a single collection entry. Returns null when the recipe isn't
   * in the user's collection.
   * @param {string} uid
   * @param {string} recipeId
   * @returns {Promise<Object|null>}
   */
  static async get(uid, recipeId) {
    if (!uid) throw new Error('CollectionService.get: uid is required');
    if (!recipeId) throw new Error('CollectionService.get: recipeId is required');
    return await FirestoreService.getDocument(this._collectionPath(uid), recipeId);
  }

  /**
   * List a user's collection entries, optionally filtered by lifecycle
   * state.
   * @param {string} uid
   * @param {Object} [filters]
   * @param {'to-try'|'rotation'} [filters.state]
   * @returns {Promise<Array<Object>>}
   */
  static async list(uid, filters = {}) {
    if (!uid) throw new Error('CollectionService.list: uid is required');
    const queryParams = {};
    if (filters.state !== undefined) {
      assertValidState(filters.state);
      queryParams.where = [['state', '==', filters.state]];
    }
    return await FirestoreService.queryDocuments(this._collectionPath(uid), queryParams);
  }

  /**
   * Add a recipe to the user's collection. Create-only: if an entry
   * already exists for this recipe, this is a no-op that returns the
   * existing entry unchanged — saving the same recipe twice must never
   * clobber `state`, `notes`, or `servingsOverride`.
   *
   * @param {string} uid
   * @param {string} recipeId
   * @param {Object} entry
   * @param {'owned'|'saved'} entry.source
   * @param {'to-try'|'rotation'} [entry.state] - Defaults to 'to-try'. Pass
   *   'rotation' only for provenance-exempt cases (e.g. the favorites
   *   migration) — see the plan's "Why not `favorite: bool`".
   * @param {string} [entry.notes]
   * @param {number} [entry.servingsOverride]
   * @param {Object} [entry.card] - Denormalised render data.
   * @returns {Promise<Object>} The resulting entry (existing or newly created).
   */
  static async create(uid, recipeId, entry) {
    if (!uid) throw new Error('CollectionService.create: uid is required');
    if (!recipeId) throw new Error('CollectionService.create: recipeId is required');
    if (!entry || typeof entry !== 'object') {
      throw new Error('CollectionService.create: entry is required');
    }
    assertValidSource(entry.source);
    const state = entry.state ?? DEFAULT_STATE;
    assertValidState(state);

    const existing = await this.get(uid, recipeId);
    if (existing) {
      return existing;
    }

    const payload = {
      source: entry.source,
      state,
      addedAt: Timestamp.now(),
    };
    if (entry.notes !== undefined) payload.notes = entry.notes;
    if (entry.servingsOverride !== undefined) payload.servingsOverride = entry.servingsOverride;
    if (entry.card !== undefined) payload.card = entry.card;

    await FirestoreService.setDocument(this._collectionPath(uid), recipeId, payload);
    return { id: recipeId, ...payload };
  }

  /**
   * Patch fields on an existing collection entry. `source` is immutable
   * after create (also enforced in firestore.rules) — this throws before
   * ever reaching Firestore rather than surfacing a bare permission error.
   *
   * @param {string} uid
   * @param {string} recipeId
   * @param {Object} patch
   * @returns {Promise<void>}
   */
  static async update(uid, recipeId, patch) {
    if (!uid) throw new Error('CollectionService.update: uid is required');
    if (!recipeId) throw new Error('CollectionService.update: recipeId is required');
    if (!patch || typeof patch !== 'object') {
      throw new Error('CollectionService.update: patch is required');
    }
    if (patch.source !== undefined) {
      throw new Error('CollectionService.update: source cannot be changed after creation');
    }
    if (patch.state !== undefined) {
      assertValidState(patch.state);
    }
    return await FirestoreService.updateDocument(this._collectionPath(uid), recipeId, patch);
  }

  /**
   * Remove a recipe from the user's collection. Callers that need to
   * confirm destructive removal (e.g. an entry carrying notes) do so
   * before calling this — see Stage 2's "un-hearting" rule.
   * @param {string} uid
   * @param {string} recipeId
   * @returns {Promise<void>}
   */
  static async delete(uid, recipeId) {
    if (!uid) throw new Error('CollectionService.delete: uid is required');
    if (!recipeId) throw new Error('CollectionService.delete: recipeId is required');
    return await FirestoreService.deleteDocument(this._collectionPath(uid), recipeId);
  }

  /**
   * Move a collection entry to a new lifecycle state. Graduation is
   * always a manual, explicit action — see the plan's "Why manual
   * graduation".
   * @param {string} uid
   * @param {string} recipeId
   * @param {'to-try'|'rotation'} state
   * @returns {Promise<void>}
   */
  static async setState(uid, recipeId, state) {
    assertValidState(state);
    return await this.update(uid, recipeId, { state });
  }

  /**
   * Patch the private overlay (notes, servings override) on an existing
   * entry. Only the keys explicitly present in `overlay` are written —
   * pass `notes: null` (not `undefined`) to clear a note.
   * @param {string} uid
   * @param {string} recipeId
   * @param {Object} overlay
   * @param {string} [overlay.notes]
   * @param {number} [overlay.servingsOverride]
   * @returns {Promise<void>}
   */
  static async updateOverlay(uid, recipeId, overlay = {}) {
    const patch = {};
    if (Object.prototype.hasOwnProperty.call(overlay, 'notes')) {
      patch.notes = overlay.notes;
    }
    if (Object.prototype.hasOwnProperty.call(overlay, 'servingsOverride')) {
      patch.servingsOverride = overlay.servingsOverride;
    }
    if (Object.keys(patch).length === 0) {
      throw new Error(
        'CollectionService.updateOverlay: at least one of notes or servingsOverride is required',
      );
    }
    return await this.update(uid, recipeId, patch);
  }
}

function assertValidSource(source) {
  if (!VALID_SOURCES.includes(source)) {
    throw new Error(
      `CollectionService: invalid source "${source}" — must be one of ${VALID_SOURCES.join(', ')}`,
    );
  }
}

function assertValidState(state) {
  if (!VALID_STATES.includes(state)) {
    throw new Error(
      `CollectionService: invalid state "${state}" — must be one of ${VALID_STATES.join(', ')}`,
    );
  }
}

export const collectionService = CollectionService;
