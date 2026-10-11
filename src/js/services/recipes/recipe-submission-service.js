// src/js/services/recipes/recipe-submission-service.js

import { Timestamp } from 'firebase/firestore';
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
 * Until release 3b, approval publishes the submitted recipe in place
 * (`publishedId` is the recipe itself); from 3b it creates a published copy.
 *
 * Public API:
 *   - submit({ recipeId, authorId })
 *   - get(recipeId)
 *   - submissionWrite({ recipeId, authorId })  // batch op for RecipeService.create({ alsoWrite })
 *   - listPending()                       // manager: [{ submission, recipe }]
 *   - approve(recipeId, { reviewedBy })   // manager
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
   * Reject a submission. Matches the existing behaviour: the proposed recipe is
   * deleted (with its media), and so is its submission.
   * @param {string} recipeId
   * @returns {Promise<void>}
   */
  static async reject(recipeId) {
    if (!recipeId) throw new Error('RecipeSubmissionService.reject: recipeId is required');
    await RecipeService.delete(recipeId);
    await FirestoreService.deleteDocument(COLLECTION, recipeId).catch(() => {});
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
