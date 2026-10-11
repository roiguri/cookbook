// src/js/services/recipes/recipe-submission-service.js

import { Timestamp, serverTimestamp } from 'firebase/firestore';
import { FirestoreService } from '../_firebase/firestore-service.js';
import { RecipeService, VISIBILITY } from './recipe-service.js';

const COLLECTION = 'recipe_submissions';

export const SUBMISSION_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

/**
 * RecipeSubmissionService — the family-book approval queue
 *
 * A recipe becomes public only through an approved submission. Submissions are
 * their own `recipe_submissions` collection (same pattern as
 * RecipeEditSuggestionService), so an author can never approve their own recipe:
 * they create a `pending` submission; only managers change its status.
 *
 * The document id is the submitted recipe's id, which enforces at most one
 * submission per recipe.
 *
 * Approval publishes the submitted recipe in place (decided 2026-10-11): it
 * stays in its author's library, now in the family book. A rejection keeps the
 * recipe private with the manager's note; the author can edit and resubmit.
 * Plain users' submissions are "submit and forget" (they have no My recipes),
 * so a rejected one is discarded instead.
 *
 * Public API:
 *   - submit({ recipeId, authorId })
 *   - get(recipeId)
 *   - submissionWrite({ recipeId, authorId })  // batch op for RecipeService.create({ alsoWrite })
 *   - withdraw(recipeId)                  // author/manager, best-effort
 *   - cancel(recipeId)                    // author: cancel pending / remove rejected
 *   - resubmit(recipeId)                  // author: rejected → pending (resubmission)
 *   - listForAuthor(authorId)             // author: their submissions
 *   - listMineWithStatus(authorId)        // author: their recipes + submission status
 *   - listPending()                       // manager: [{ submission, recipe }]
 *   - approve(recipeId, { reviewedBy })   // manager
 *   - reject(recipeId, { note, reviewedBy }) // manager: keep the recipe, with a note
 *   - discard(recipeId)                   // manager: delete a plain user's rejected proposal
 *   - deleteRecipe(recipeId)              // delete a recipe and its submission (author / manager)
 *   - reject(recipeId, { reviewedBy })    // manager: deletes the proposal, as before
 */
export class RecipeSubmissionService {
  /**
   * Put a recipe in the approval queue.
   * @param {Object} params
   * @param {string} params.recipeId - The recipe being submitted (its author's).
   * @param {string} params.authorId - UID of the author (must be the caller).
   * @returns {Promise<void>}
   */
  static async submit({ recipeId, authorId } = {}) {
    const op = RecipeSubmissionService.submissionWrite({ recipeId, authorId });
    await FirestoreService.setDocument(COLLECTION, op.id, op.data);
  }

  /**
   * The write that submits a recipe, for committing in the same batch as the
   * recipe itself (`RecipeService.create({ alsoWrite })`) — required for users
   * who may not keep private recipes of their own.
   * @param {Object} params
   * @param {string} params.recipeId
   * @param {string} params.authorId
   * @returns {{ type: 'set', collection: string, id: string, data: Object }}
   */
  static submissionWrite({ recipeId, authorId } = {}) {
    if (!recipeId) throw new Error('RecipeSubmissionService.submit: recipeId is required');
    if (!authorId) throw new Error('RecipeSubmissionService.submit: authorId is required');
    return {
      type: 'set',
      collection: COLLECTION,
      id: recipeId,
      data: {
        recipeId,
        authorId,
        status: SUBMISSION_STATUS.PENDING,
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
        publishedId: null,
        createdAt: Timestamp.now(),
      },
    };
  }

  /**
   * Withdraw a recipe's pending submission, if it has one — e.g. before its
   * author deletes the recipe. Best-effort: a missing submission (or one the
   * caller may not delete) is ignored; the manager queue self-heals leftovers.
   * @param {string} recipeId
   * @returns {Promise<void>}
   */
  static async withdraw(recipeId) {
    if (!recipeId) return;
    try {
      await FirestoreService.deleteDocument(COLLECTION, recipeId);
    } catch {
      // nothing to withdraw
    }
  }

  /**
   * The submission for a recipe, if any.
   * @param {string} recipeId
   * @returns {Promise<Object|null>}
   */
  static async get(recipeId) {
    return await FirestoreService.getDocument(COLLECTION, recipeId);
  }

  /**
   * Pending submissions with their recipes, newest first (sorted client-side to
   * avoid a composite index). Self-heals two states left by other manager
   * actions: a submission whose recipe was deleted is removed, and one whose
   * recipe a manager already published (e.g. by editing it) is marked approved.
   * @returns {Promise<Array<{ submission: Object, recipe: Object }>>}
   */
  static async listPending() {
    const submissions = await FirestoreService.queryDocuments(COLLECTION, {
      where: [['status', '==', SUBMISSION_STATUS.PENDING]],
    });
    const rows = await Promise.all(
      submissions.map(async (submission) => {
        const recipe = await RecipeService.get(submission.recipeId).catch(() => null);
        if (!recipe) {
          await FirestoreService.deleteDocument(COLLECTION, submission.id).catch(() => {});
          return null;
        }
        if (recipe.visibility === VISIBILITY.PUBLISHED) {
          await RecipeSubmissionService._markApproved(submission.id, { reviewedBy: null });
          return null;
        }
        return { submission, recipe };
      }),
    );
    return rows
      .filter(Boolean)
      .sort(
        (a, b) => (b.submission.createdAt?.seconds || 0) - (a.submission.createdAt?.seconds || 0),
      );
  }

  /**
   * Approve a submission: publish the recipe, then record the outcome. The
   * recipe is written first, so a retry after a partial failure is harmless.
   * @param {string} recipeId
   * @param {Object} [params]
   * @param {string} [params.reviewedBy] - Manager UID.
   * @returns {Promise<void>}
   */
  static async approve(recipeId, { reviewedBy } = {}) {
    if (!recipeId) throw new Error('RecipeSubmissionService.approve: recipeId is required');
    await RecipeService.update(recipeId, { approved: true });
    if (await RecipeSubmissionService.get(recipeId)) {
      await RecipeSubmissionService._markApproved(recipeId, { reviewedBy });
    }
  }

  /**
   * Reject a submission with a note: the recipe stays private in its author's
   * library; the author sees the note and can edit and resubmit.
   * @param {string} recipeId
   * @param {Object} params
   * @param {string} params.note - What to fix (required — the rules enforce it).
   * @param {string} [params.reviewedBy] - Manager UID.
   * @returns {Promise<void>}
   */
  static async reject(recipeId, { note, reviewedBy } = {}) {
    if (!recipeId) throw new Error('RecipeSubmissionService.reject: recipeId is required');
    const text = typeof note === 'string' ? note.trim() : '';
    if (!text) throw new Error('RecipeSubmissionService.reject: a note is required');
    await FirestoreService.updateDocument(COLLECTION, recipeId, {
      status: SUBMISSION_STATUS.REJECTED,
      rejectionReason: text,
      reviewedBy: reviewedBy || null,
      reviewedAt: Timestamp.now(),
    });
  }

  /**
   * Discard a plain user's proposal (they have no My recipes to see a note in):
   * the recipe is deleted with its media, and so is its submission.
   * @param {string} recipeId
   * @returns {Promise<void>}
   */
  static async discard(recipeId) {
    if (!recipeId) throw new Error('RecipeSubmissionService.discard: recipeId is required');
    await RecipeSubmissionService.deleteRecipe(recipeId);
  }

  /**
   * Delete a recipe (with its photos and media) and its submission, if any —
   * the one way to delete a recipe, so no submission is left pointing at it.
   * The submission goes second (best-effort), so a failed recipe delete never
   * leaves the recipe without its record.
   * @param {string} recipeId
   * @returns {Promise<void>}
   */
  static async deleteRecipe(recipeId) {
    if (!recipeId) throw new Error('RecipeSubmissionService.deleteRecipe: recipeId is required');
    await RecipeService.delete(recipeId);
    await RecipeSubmissionService.withdraw(recipeId);
  }

  /**
   * The author cancels a pending submission or removes a rejected one. Unlike
   * `withdraw`, failures are reported.
   * @param {string} recipeId
   * @returns {Promise<void>}
   */
  static async cancel(recipeId) {
    if (!recipeId) throw new Error('RecipeSubmissionService.cancel: recipeId is required');
    await FirestoreService.deleteDocument(COLLECTION, recipeId);
  }

  /**
   * The author resubmits a rejected recipe (after editing it): back to pending,
   * marked as a resubmission for the queue. The manager's last note is kept.
   * @param {string} recipeId
   * @returns {Promise<void>}
   */
  static async resubmit(recipeId) {
    if (!recipeId) throw new Error('RecipeSubmissionService.resubmit: recipeId is required');
    await FirestoreService.updateDocument(COLLECTION, recipeId, {
      status: SUBMISSION_STATUS.PENDING,
      resubmittedAt: serverTimestamp(),
    });
  }

  /**
   * An author's recipes (RecipeService.listMine) with what their status badges
   * need: `submissionStatus` from their submissions, and `ownView: true`.
   * Shared by My recipes and search.
   * @param {string} authorId
   * @returns {Promise<Array<Object>>}
   */
  static async listMineWithStatus(authorId) {
    if (!authorId) return [];
    const [mine, submissions] = await Promise.all([
      RecipeService.listMine(authorId),
      RecipeSubmissionService.listForAuthor(authorId).catch(() => []),
    ]);
    const statusOf = new Map(submissions.map((s) => [s.recipeId, s.status]));
    return mine.map((r) => ({ ...r, submissionStatus: statusOf.get(r.id), ownView: true }));
  }

  /**
   * An author's submissions (any status), e.g. to show pending / rejected /
   * published badges on their recipes.
   * @param {string} authorId
   * @returns {Promise<Array<Object>>}
   */
  static async listForAuthor(authorId) {
    if (!authorId) return [];
    return await FirestoreService.queryDocuments(COLLECTION, {
      where: [['authorId', '==', authorId]],
    });
  }

  static async _markApproved(recipeId, { reviewedBy }) {
    await FirestoreService.updateDocument(COLLECTION, recipeId, {
      status: SUBMISSION_STATUS.APPROVED,
      reviewedBy: reviewedBy || null,
      reviewedAt: Timestamp.now(),
      publishedId: recipeId,
    });
  }
}
