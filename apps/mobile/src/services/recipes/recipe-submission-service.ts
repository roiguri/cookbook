import { submissionRecord, VISIBILITY } from '@cookbook/core/recipe-model';
import {
  deleteDocument,
  getDocument,
  listDocuments,
  serverTimestamp,
  setDocument,
  updateDocument,
  where,
} from '../_firebase/firestore-adapter';
import { deleteStorageFile } from '../_firebase/storage-adapter';
import { captureError } from '../logger';
import { RecipeImageService } from './recipe-image-service';
import { RecipeService } from './recipe-service';
import { RecipeShareService } from './recipe-share-service';

const COLLECTION = 'recipe_submissions';
const RECIPES_COLLECTION = 'recipes';

export const SUBMISSION_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const;

export type SubmissionStatus = (typeof SUBMISSION_STATUS)[keyof typeof SUBMISSION_STATUS];

export interface RecipeSubmission {
  id: string;
  recipeId: string;
  authorId: string;
  status: SubmissionStatus;
  reviewedBy?: string | null;
  reviewedAt?: any;
  rejectionReason?: string | null;
  createdAt?: any;
  submittedAt?: any;
  resubmittedAt?: any;
  recipeName?: string;
  authorName?: string;
  category?: string;
}

export interface PendingSubmissionRow extends RecipeSubmission {
  submission: RecipeSubmission;
  recipe: any;
}

export interface SubmitRecipeParams {
  recipeId: string;
  authorId: string;
  recipeName?: string;
  authorName?: string;
  category?: string;
}

function timestampMillis(value: any): number {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export const RecipeSubmissionService = {
  /**
   * Fetches the submission record for a recipe, or null if not submitted.
   */
  async getByRecipeId(recipeId: string): Promise<RecipeSubmission | null> {
    if (!recipeId) return null;
    return getDocument<RecipeSubmission>(COLLECTION, recipeId);
  },

  /**
   * Lists all submissions belonging to a given author.
   */
  async listMine(uid: string): Promise<RecipeSubmission[]> {
    if (!uid) return [];
    return listDocuments<RecipeSubmission>(COLLECTION, [where('authorId', '==', uid)]);
  },

  /**
   * Returns a Map keyed by `recipeId` -> submission document for the author.
   */
  async listMineWithStatus(uid: string): Promise<Map<string, RecipeSubmission>> {
    if (!uid) return new Map();
    const submissions = await this.listMine(uid);
    return new Map(submissions.map((sub) => [sub.recipeId || sub.id, sub]));
  },

  /**
   * Lists all pending submissions paired with their recipes (manager dashboard).
   * Self-heals dangling submissions (deleted recipe) and already-published recipes.
   */
  async listPending(): Promise<PendingSubmissionRow[]> {
    const submissions = await listDocuments<RecipeSubmission>(COLLECTION, [
      where('status', '==', SUBMISSION_STATUS.PENDING),
    ]);

    const rows = await Promise.all(
      submissions.map(async (submission): Promise<PendingSubmissionRow | null> => {
        const targetId = submission.recipeId || submission.id;
        const recipe = await RecipeService.getById(targetId).catch(() => null);
        if (!recipe) {
          await deleteDocument(COLLECTION, submission.id).catch(() => {});
          return null;
        }
        if (recipe.visibility === VISIBILITY.PUBLISHED) {
          await updateDocument(
            COLLECTION,
            {
              status: SUBMISSION_STATUS.APPROVED,
              reviewedBy: null,
              reviewedAt: serverTimestamp(),
            },
            submission.id,
          ).catch(() => {});
          return null;
        }
        return {
          ...submission,
          submission,
          recipe,
        };
      }),
    );

    return rows
      .filter((row): row is PendingSubmissionRow => row !== null)
      .sort((a, b) => {
        const timeA = timestampMillis(a.resubmittedAt || a.submittedAt || a.createdAt);
        const timeB = timestampMillis(b.resubmittedAt || b.submittedAt || b.createdAt);
        return timeB - timeA;
      });
  },

  /**
   * Submits an author's private recipe to the family-book approval queue.
   */
  async submit({
    recipeId,
    authorId,
    recipeName,
    authorName,
    category,
  }: SubmitRecipeParams): Promise<void> {
    if (!recipeId) {
      throw new Error('RecipeSubmissionService.submit: recipeId is required');
    }
    if (!authorId) {
      throw new Error('RecipeSubmissionService.submit: authorId is required');
    }
    const base = submissionRecord({
      recipeId,
      authorId,
      createdAt: serverTimestamp(),
    });
    const payload: Record<string, any> = {
      ...base,
      submittedAt: serverTimestamp(),
      ...(recipeName ? { recipeName } : {}),
      ...(authorName ? { authorName } : {}),
      ...(category ? { category } : {}),
    };
    await setDocument(COLLECTION, payload, { merge: false }, recipeId);
  },

  /**
   * Author cancels a pending submission or removes a rejected submission.
   */
  async cancel(recipeId: string): Promise<void> {
    if (!recipeId) {
      throw new Error('RecipeSubmissionService.cancel: recipeId is required');
    }
    await deleteDocument(COLLECTION, recipeId);
  },

  /**
   * Best-effort withdraws a recipe's submission (e.g. during recipe deletion).
   */
  async withdraw(recipeId: string): Promise<void> {
    if (!recipeId) return;
    try {
      await deleteDocument(COLLECTION, recipeId);
    } catch {
      // Missing submission or non-deletable approved record — safely ignored
    }
  },

  /**
   * Author resubmits a rejected recipe back to the manager queue.
   *
   * P0 INVARIANT (firestore.rules:273-279):
   * Updates ONLY `status: 'pending'` and `resubmittedAt: serverTimestamp()` —
   * zero extra keys so `affectedKeys().hasOnly(['status', 'resubmittedAt'])` passes
   * and triggers `onRecipeResubmitted`.
   */
  async resubmit(recipeId: string): Promise<void> {
    if (!recipeId) {
      throw new Error('RecipeSubmissionService.resubmit: recipeId is required');
    }
    await updateDocument(
      COLLECTION,
      {
        status: SUBMISSION_STATUS.PENDING,
        resubmittedAt: serverTimestamp(),
      },
      recipeId,
    );
  },

  /**
   * Manager approves a submission: publishes the recipe in place, then marks the
   * submission record as `approved`.
   */
  async approve(recipeId: string, managerUid: string): Promise<void> {
    if (!recipeId) {
      throw new Error('RecipeSubmissionService.approve: recipeId is required');
    }
    await updateDocument(
      RECIPES_COLLECTION,
      {
        visibility: VISIBILITY.PUBLISHED,
        updatedAt: serverTimestamp(),
      },
      recipeId,
    );

    const existing = await this.getByRecipeId(recipeId);
    if (existing) {
      await updateDocument(
        COLLECTION,
        {
          status: SUBMISSION_STATUS.APPROVED,
          reviewedBy: managerUid || null,
          reviewedAt: serverTimestamp(),
        },
        recipeId,
      );
    }
  },

  /**
   * Manager rejects a pending submission with a mandatory non-empty reason.
   *
   * P0 INVARIANT (INV-P0-07 & firestore.rules:270-272):
   * Throws immediately if `rejectionReason` is empty or whitespace-only.
   */
  async reject(recipeId: string, managerUid: string, rejectionReason: string): Promise<void> {
    if (!recipeId) {
      throw new Error('RecipeSubmissionService.reject: recipeId is required');
    }
    const trimmedReason = typeof rejectionReason === 'string' ? rejectionReason.trim() : '';
    if (!trimmedReason) {
      throw new Error('יש להזין סיבת דחייה לפני דחיית המתכון');
    }

    await updateDocument(
      COLLECTION,
      {
        status: SUBMISSION_STATUS.REJECTED,
        rejectionReason: trimmedReason,
        reviewedBy: managerUid || null,
        reviewedAt: serverTimestamp(),
      },
      recipeId,
    );
  },

  /**
   * Manager discards a plain user's rejected proposal (deletes recipe + Storage files + submission).
   */
  async discard(recipeId: string): Promise<void> {
    if (!recipeId) {
      throw new Error('RecipeSubmissionService.discard: recipeId is required');
    }
    await this.deleteRecipe(recipeId);
  },

  /**
   * Deletes a private recipe cleanly:
   * 1. Cleans up Storage images & media files while `isRecipeAuthor` still passes `storage.rules`.
   * 2. Deletes the recipe document via `RecipeService.delete(recipeId)`.
   * 3. Best-effort withdraws any pending/rejected submission doc.
   * 4. Best-effort removes all family share records via `RecipeShareService.removeAll`.
   */
  async deleteRecipe(
    recipeId: string,
    opts?: { authorId?: string; images?: any[] },
  ): Promise<void> {
    if (!recipeId) {
      throw new Error('RecipeSubmissionService.deleteRecipe: recipeId is required');
    }

    const existing =
      !opts?.authorId || !opts?.images
        ? await RecipeService.getById(recipeId).catch(() => null)
        : null;

    const resolvedAuthorId = opts?.authorId || existing?.authorId || undefined;
    const resolvedImages = opts?.images || existing?.images;
    const mediaInstructions: any[] = Array.isArray(existing?.mediaInstructions)
      ? existing.mediaInstructions
      : [];

    // Delete Storage assets before deleting the recipe doc so storage.rules `isRecipeAuthor` passes
    try {
      await RecipeImageService.deleteRecipeImages(recipeId, resolvedImages);
    } catch (err) {
      captureError(err, { service: 'recipeSubmission', op: 'deleteRecipeImages', recipeId });
    }

    if (mediaInstructions.length > 0) {
      await Promise.all(
        mediaInstructions
          .filter((item) => item && typeof item.path === 'string' && item.path.length > 0)
          .map((item) =>
            deleteStorageFile(item.path).catch((err) => {
              captureError(err, { service: 'recipeSubmission', op: 'deleteRecipeMedia', recipeId });
            }),
          ),
      );
    }

    // Delete the Firestore recipe document (throws if unauthorized, preventing premature cleanup)
    await RecipeService.delete(recipeId);

    // Best-effort withdraw submission & remove all family share records
    await this.withdraw(recipeId);
    await RecipeShareService.removeAll(recipeId, resolvedAuthorId);
  },
};
