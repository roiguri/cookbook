import { getCurrentAuthUser } from '../_firebase/auth-adapter';
import {
  createWriteBatch,
  deleteDocument,
  docRef,
  getDocument,
  listCollectionGroup,
  listDocuments,
  serverTimestamp,
  where,
} from '../_firebase/firestore-adapter';
import { callCloudFunction } from '../_firebase/functions-adapter';
import { captureError } from '../logger';

export interface FamilyMember {
  uid: string;
  name: string;
  avatarUrl: string | null;
}

export interface RecipeShareRecord {
  id: string;
  recipientUid: string;
  authorId: string;
  authorName: string;
  sharedAt: any;
}

export interface SharedWithMeRecord {
  recipeId: string;
  authorId: string;
  authorName: string;
  sharedAt: any;
}

interface RawShareDoc {
  recipientUid: string;
  authorId: string;
  authorName: string;
  sharedAt: any;
}

const sharesCollectionPath = (recipeId: string) => `recipes/${recipeId}/shares`;

function timestampMillis(value: any): number {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Resolves a guaranteed non-empty authorName (1..100 chars) so firestore.rules
 * `authorName.size() > 0 && authorName.size() <= 100` never rejects a share write.
 */
function resolveNonEmptyAuthorName(rawName?: string | null): string {
  const fromParam = (rawName || '').trim();
  if (fromParam) return fromParam.slice(0, 100);

  const authUser = getCurrentAuthUser();
  const fromDisplay = (authUser?.displayName || '').trim();
  if (fromDisplay) return fromDisplay.slice(0, 100);

  const fromEmail = (authUser?.email || '').split('@')[0]?.trim();
  if (fromEmail) return fromEmail.slice(0, 100);

  return 'בן משפחה';
}

const BATCH_LIMIT = 450;

export const RecipeShareService = {
  /**
   * Calls `listFamilyMembers` callable Cloud Function (returns `{ members: [{ uid, name, avatarUrl }] }`).
   * Excludes the caller and omits roles/emails per `functions/utils/family.js`.
   */
  async listFamilyMembers(): Promise<FamilyMember[]> {
    const res = await callCloudFunction<
      Record<string, never>,
      { members?: Array<{ uid: string; name?: string | null; avatarUrl?: string | null }> }
    >('listFamilyMembers', {});
    const members = Array.isArray(res?.members) ? res.members : [];
    return members.map((member) => ({
      uid: member.uid,
      name: (member.name || '').trim(),
      avatarUrl: member.avatarUrl ?? null,
    }));
  },

  /**
   * Lists existing share records for an author's private recipe, newest first.
   * Filters by `authorId` to satisfy `firestore.rules` for non-manager authors.
   */
  async listSharesForRecipe(recipeId: string, authorId?: string): Promise<RecipeShareRecord[]> {
    if (!recipeId) return [];
    const resolvedAuthorId = authorId || getCurrentAuthUser()?.uid || '';
    const constraints = resolvedAuthorId ? [where('authorId', '==', resolvedAuthorId)] : [];
    const docs = await listDocuments<RawShareDoc>(sharesCollectionPath(recipeId), constraints);
    return docs
      .map((docItem) => ({
        id: docItem.id,
        recipientUid: docItem.recipientUid || docItem.id,
        authorId: docItem.authorId,
        authorName: docItem.authorName || '',
        sharedAt: docItem.sharedAt ?? null,
      }))
      .sort((a, b) => timestampMillis(b.sharedAt) - timestampMillis(a.sharedAt));
  },

  /**
   * Fetches the signed-in recipient's own share record for a private recipe, or null.
   */
  async getMine(recipeId: string, uid: string): Promise<RecipeShareRecord | null> {
    if (!recipeId || !uid) return null;
    try {
      const docItem = await getDocument<RawShareDoc>('recipes', recipeId, 'shares', uid);
      if (!docItem) return null;
      return {
        id: docItem.id,
        recipientUid: docItem.recipientUid || docItem.id,
        authorId: docItem.authorId,
        authorName: docItem.authorName || '',
        sharedAt: docItem.sharedAt ?? null,
      };
    } catch {
      return null;
    }
  },

  /**
   * Lists all share records where the user is the recipient via collectionGroup('shares'),
   * newest share first.
   */
  async listSharedWithMe(uid: string): Promise<SharedWithMeRecord[]> {
    if (!uid) return [];
    const docs = await listCollectionGroup<RawShareDoc>('shares', [
      where('recipientUid', '==', uid),
    ]);
    return docs
      .filter((docItem) => Boolean(docItem._parentId))
      .map((docItem) => ({
        recipeId: docItem._parentId as string,
        authorId: docItem.authorId,
        authorName: docItem.authorName || '',
        sharedAt: docItem.sharedAt ?? null,
      }))
      .sort((a, b) => timestampMillis(b.sharedAt) - timestampMillis(a.sharedAt));
  },

  /**
   * Batch-shares a private recipe with multiple approved family members.
   *
   * P0 INVARIANT (firestore.rules:220-227):
   * Writes EXACT 4 keys `{ recipientUid, authorId, authorName, sharedAt: serverTimestamp() }`
   * on `recipes/${recipeId}/shares/${recipientUid}` via writeBatch — zero extra keys.
   */
  async shareWithMany(
    recipeId: string,
    recipientUids: string[],
    author: { uid: string; name: string },
  ): Promise<void> {
    if (!recipeId || !author?.uid) {
      throw new Error('RecipeShareService.shareWithMany: recipeId and author.uid are required');
    }
    const nonEmptyName = resolveNonEmptyAuthorName(author.name);
    const uniqueUids = Array.from(new Set(recipientUids)).filter(
      (uid) => typeof uid === 'string' && uid.trim().length > 0 && uid !== author.uid,
    );
    if (uniqueUids.length === 0) return;

    for (let i = 0; i < uniqueUids.length; i += BATCH_LIMIT) {
      const chunk = uniqueUids.slice(i, i + BATCH_LIMIT);
      const batch = createWriteBatch();
      for (const recipientUid of chunk) {
        batch.set(docRef('recipes', recipeId, 'shares', recipientUid), {
          recipientUid,
          authorId: author.uid,
          authorName: nonEmptyName,
          sharedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }
  },

  /**
   * Revokes a single recipient's share access (author revoking or recipient leaving).
   */
  async remove(recipeId: string, recipientUid: string): Promise<void> {
    if (!recipeId || !recipientUid) return;
    await deleteDocument('recipes', recipeId, 'shares', recipientUid);
  },

  /**
   * Best-effort removes all share records for a recipe (e.g. when deleting the recipe).
   */
  async removeAll(recipeId: string, authorId?: string): Promise<void> {
    if (!recipeId) return;
    try {
      const resolvedAuthorId = authorId || getCurrentAuthUser()?.uid || undefined;
      let shares = await this.listSharesForRecipe(recipeId, resolvedAuthorId);

      // If no authorId was supplied and a manager is deleting another author's recipe,
      // try an unfiltered read as fallback (managers pass firestore.rules).
      if (shares.length === 0 && !authorId) {
        try {
          const allDocs = await listDocuments<RawShareDoc>(sharesCollectionPath(recipeId));
          shares = allDocs.map((docItem) => ({
            id: docItem.id,
            recipientUid: docItem.recipientUid || docItem.id,
            authorId: docItem.authorId,
            authorName: docItem.authorName || '',
            sharedAt: docItem.sharedAt ?? null,
          }));
        } catch {
          // Non-manager caller: ignore fallback error
        }
      }

      if (shares.length === 0) return;

      for (let i = 0; i < shares.length; i += BATCH_LIMIT) {
        const chunk = shares.slice(i, i + BATCH_LIMIT);
        const batch = createWriteBatch();
        for (const share of chunk) {
          batch.delete(docRef('recipes', recipeId, 'shares', share.id));
        }
        await batch.commit();
      }
    } catch (err) {
      captureError(err, { service: 'recipeShare', op: 'removeAll', recipeId });
    }
  },
};
