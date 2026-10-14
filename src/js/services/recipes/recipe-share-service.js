// src/js/services/recipes/recipe-share-service.js

import { serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirebaseApp } from '../_firebase/firebase-service.js';
import { FirestoreService } from '../_firebase/firestore-service.js';
import { RecipeService } from './recipe-service.js';

const sharesOf = (recipeId) => `recipes/${recipeId}/shares`;

const time = (t) => t?.toMillis?.() ?? (t ? new Date(t).getTime() : 0);

/**
 * RecipeShareService — sharing a private recipe with family
 *
 * The author of a private recipe gives approved family (or managers) a live,
 * read-only view: one record per recipient at `recipes/{recipeId}/shares/{uid}`
 * (`{ recipientUid, authorId, authorName, sharedAt }`), created or deleted,
 * never edited. Security rules let a recipient read the recipe and its photos
 * while their record exists and they stay approved. Plan:
 * docs/archive/feature-plans/recipe-sharing.md (R3).
 *
 * Public API:
 *   - listFamily()                                  // picker: [{ uid, name, avatarUrl }]
 *   - listForRecipe(recipeId, authorId)             // author: who has access
 *   - share(recipeId, { authorId, authorName, recipientUids })
 *   - remove(recipeId, recipientUid)                // author removes / recipient leaves
 *   - removeAll(recipeId, authorId)                 // with the recipe, best-effort
 *   - getMine(recipeId, uid)                        // recipient: their record, or null
 *   - listSharedWithMe(uid)                         // recipient: the recipes, with `sharedBy`
 */
export class RecipeShareService {
  /**
   * The family list for the picker: name and avatar of approved family and
   * managers, the caller left out. Comes from a Cloud Function because `users/`
   * isn't readable by other users.
   * @returns {Promise<Array<{uid: string, name: string|null, avatarUrl: string|null}>>}
   */
  static async listFamily() {
    const list = httpsCallable(getFunctions(getFirebaseApp()), 'listFamilyMembers');
    const { data } = await list();
    return data?.members || [];
  }

  /**
   * Who has access to the author's recipe, newest first.
   * @param {string} recipeId
   * @param {string} authorId - The signed-in author (the rules require the filter).
   * @returns {Promise<Array<Object>>} Share records ({ id, recipientUid, sharedAt, … })
   */
  static async listForRecipe(recipeId, authorId) {
    if (!recipeId || !authorId) return [];
    const shares = await FirestoreService.queryDocuments(sharesOf(recipeId), {
      where: [['authorId', '==', authorId]],
    });
    return shares.sort((a, b) => time(b.sharedAt) - time(a.sharedAt));
  }

  /**
   * Share a private recipe with family members, in one batch.
   * @param {string} recipeId
   * @param {Object} params
   * @param {string} params.authorId - The signed-in author.
   * @param {string} params.authorName - Shown to recipients ("מ־‹name›").
   * @param {string[]} params.recipientUids
   * @returns {Promise<void>}
   */
  static async share(recipeId, { authorId, authorName, recipientUids = [] } = {}) {
    if (!recipeId || !authorId) {
      throw new Error('RecipeShareService.share: recipeId and authorId are required');
    }
    const name = (authorName || '').trim().slice(0, 100);
    if (!name) throw new Error('RecipeShareService.share: authorName is required');
    const uids = [...new Set(recipientUids)].filter((uid) => uid && uid !== authorId);
    if (!uids.length) return;
    await FirestoreService.batchWrite(
      uids.map((recipientUid) => ({
        type: 'set',
        collection: sharesOf(recipeId),
        id: recipientUid,
        data: { recipientUid, authorId, authorName: name, sharedAt: serverTimestamp() },
      })),
    );
  }

  /**
   * Remove one person's access: the author removing them, or the recipient
   * taking it off their own list.
   * @param {string} recipeId
   * @param {string} recipientUid
   * @returns {Promise<void>}
   */
  static async remove(recipeId, recipientUid) {
    if (!recipeId || !recipientUid) return;
    await FirestoreService.deleteDocument(sharesOf(recipeId), recipientUid);
  }

  /**
   * Remove everyone's access, when the author deletes the recipe. Best-effort:
   * a leftover record points at a missing recipe, which listSharedWithMe skips.
   * @param {string} recipeId
   * @param {string} authorId
   * @returns {Promise<void>}
   */
  static async removeAll(recipeId, authorId) {
    try {
      const shares = await RecipeShareService.listForRecipe(recipeId, authorId);
      if (!shares.length) return;
      await FirestoreService.batchWrite(
        shares.map((share) => ({ type: 'delete', collection: sharesOf(recipeId), id: share.id })),
      );
    } catch (error) {
      console.warn('RecipeShareService.removeAll: shares left behind', error);
    }
  }

  /**
   * The recipient's own record for a recipe, or null when it isn't shared with them.
   * @param {string} recipeId
   * @param {string} uid - The signed-in user.
   * @returns {Promise<Object|null>}
   */
  static async getMine(recipeId, uid) {
    if (!recipeId || !uid) return null;
    try {
      return await FirestoreService.getDocument(sharesOf(recipeId), uid);
    } catch {
      return null;
    }
  }

  /**
   * The recipes shared with the user, newest share first. Each carries
   * `sharedBy` ({ uid, name }) and `sharedAt`. Recipes that are gone or no
   * longer readable are skipped.
   * @param {string} uid - The signed-in user.
   * @returns {Promise<Array<Object>>}
   */
  static async listSharedWithMe(uid) {
    if (!uid) return [];
    const shares = await FirestoreService.queryCollectionGroup('shares', {
      where: [['recipientUid', '==', uid]],
    });
    const results = await Promise.allSettled(
      shares
        .filter((share) => share.parentId)
        .map(async (share) => {
          const recipe = await RecipeService.get(share.parentId);
          return recipe && recipe.authorId !== uid
            ? {
                ...recipe,
                sharedBy: { uid: share.authorId, name: share.authorName },
                sharedAt: share.sharedAt,
              }
            : null;
        }),
    );
    return results
      .map((result) => (result.status === 'fulfilled' ? result.value : null))
      .filter(Boolean)
      .sort((a, b) => time(b.sharedAt) - time(a.sharedAt));
  }
}
