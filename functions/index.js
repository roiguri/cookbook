const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const {
  extractRecipeFromImage,
  extractRecipeFromUrl,
  extractRecipeFromVideo,
  enhanceFoodImage,
  PARAMETER_TAXONOMY,
} = require('./utils/gemini-service');
const { withAuthAndRole } = require('./utils/guards');
const { FAMILY_ROLES, familyMembers } = require('./utils/family');
const apiTokens = require('./utils/api-tokens');
const { sendNotificationToRole } = require('./notifications');

// Initialize Firebase Admin
initializeApp();
const db = getFirestore();

async function logFailedUrlExtraction(url, error, userId, kind = 'url') {
  try {
    const collectionRef = db.collection('failed_url_extractions');
    const snapshot = await collectionRef.where('url', '==', url).limit(1).get();

    const errorData = {
      message: error.message || 'Unknown error',
      stack: error.stack || 'No stack trace',
      code: error.code || 'unknown',
    };

    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      await doc.ref.update({
        count: FieldValue.increment(1),
        lastAttempt: Timestamp.now(),
        error: errorData,
        lastUserId: userId,
        kind,
      });
    } else {
      await collectionRef.add({
        url: url,
        count: 1,
        firstAttempt: Timestamp.now(),
        lastAttempt: Timestamp.now(),
        error: errorData,
        lastUserId: userId,
        kind,
      });
    }
  } catch (logError) {
    console.error('Failed to log failed URL extraction:', logError);
  }
}

exports.extractRecipeFromImage = onCall(
  { secrets: ['GEMINI_API_KEY'] },
  withAuthAndRole(['approved', 'manager'], async (request) => {
    const { images } = request.data;

    if (!images || !Array.isArray(images) || images.length === 0) {
      throw new HttpsError('invalid-argument', 'The function must be called with an images array.');
    }

    try {
      return await extractRecipeFromImage(images);
    } catch (error) {
      console.error('Error extracting recipe:', error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('internal', 'Recipe extraction failed', error.message);
    }
  }),
);

const MAX_INSTRUCTION_LENGTH = 500;

function validateEnhancementParameters(parameters) {
  if (parameters === undefined || parameters === null) return;
  if (typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw new HttpsError('invalid-argument', 'parameters must be an object.');
  }
  for (const [axis, value] of Object.entries(parameters)) {
    if (!(axis in PARAMETER_TAXONOMY)) {
      throw new HttpsError('invalid-argument', `Unknown parameter axis: ${axis}.`);
    }
    if (value === null || value === undefined || value === '') continue;
    if (typeof value !== 'string' || !PARAMETER_TAXONOMY[axis][value]) {
      throw new HttpsError('invalid-argument', `Invalid value '${value}' for parameter '${axis}'.`);
    }
  }
}

function validateInstruction(instruction) {
  if (instruction === undefined || instruction === null || instruction === '') return;
  if (typeof instruction !== 'string') {
    throw new HttpsError('invalid-argument', 'instruction must be a string.');
  }
  if (instruction.length > MAX_INSTRUCTION_LENGTH) {
    throw new HttpsError(
      'invalid-argument',
      `instruction exceeds ${MAX_INSTRUCTION_LENGTH} characters.`,
    );
  }
}

exports.enhanceFoodImage = onCall(
  { secrets: ['GEMINI_API_KEY'] },
  withAuthAndRole(['manager'], async (request) => {
    const { image, parameters, instruction } = request.data || {};

    if (!image || typeof image !== 'object' || typeof image.base64 !== 'string' || !image.base64) {
      throw new HttpsError(
        'invalid-argument',
        'image must be an object of shape { base64, mimeType? }.',
      );
    }
    validateEnhancementParameters(parameters);
    validateInstruction(instruction);

    try {
      return await enhanceFoodImage({ image, parameters, instruction });
    } catch (error) {
      console.error('Error enhancing image:', error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('internal', 'Image enhancement failed');
    }
  }),
);

exports.extractRecipeFromUrl = onCall(
  { secrets: ['GEMINI_API_KEY'] },
  withAuthAndRole(['approved', 'manager'], async (request, { uid }) => {
    const { url } = request.data;

    if (!url || typeof url !== 'string') {
      throw new HttpsError(
        'invalid-argument',
        'The function must be called with a valid URL string.',
      );
    }

    try {
      new URL(url);
    } catch (urlError) {
      throw new HttpsError('invalid-argument', 'Invalid URL format provided.');
    }

    try {
      return await extractRecipeFromUrl(url);
    } catch (error) {
      console.error('Error extracting recipe from URL:', error);
      await logFailedUrlExtraction(url, error, uid, 'url');
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('internal', 'Recipe extraction from URL failed', error.message);
    }
  }),
);

exports.extractRecipeFromVideo = onCall(
  { secrets: ['GEMINI_API_KEY'], timeoutSeconds: 300 },
  withAuthAndRole(['approved', 'manager'], async (request, { uid }) => {
    const { url } = request.data || {};

    if (!url || typeof url !== 'string') {
      throw new HttpsError(
        'invalid-argument',
        'The function must be called with a YouTube URL string.',
      );
    }

    try {
      return await extractRecipeFromVideo(url);
    } catch (error) {
      console.error('Error extracting recipe from video:', error);
      await logFailedUrlExtraction(url, error, uid, 'video');
      if (error instanceof HttpsError) throw error;
      // Surface "not a YouTube URL" as invalid-argument so the client can show
      // a precise message instead of a generic internal error.
      if (error.message && error.message.includes('is not a valid YouTube URL')) {
        throw new HttpsError('invalid-argument', error.message);
      }
      throw new HttpsError('internal', 'Recipe extraction from video failed', error.message);
    }
  }),
);

/**
 * Copy an edit suggestion's staged files (`suggestions/{id}/images|media/…`) into
 * its recipe's folders (`recipes/{recipeId}/images|media/…`) so a manager can
 * apply the suggestion. Returns `{ mapping: { oldPath: newPath } }` for the
 * client to repoint the suggestion's changes.
 *
 * Idempotent: a file already copied is not copied again. Copies are re-tagged
 * `uploadedBy` = the approving manager, so the suggester can't later delete a
 * file that has become part of the live recipe (storage.rules let uploaders
 * delete their own files). Runs server-side because suggesters' staged files
 * and the recipe's folder have different owners.
 */
exports.promoteSuggestionFiles = onCall(
  withAuthAndRole(['manager'], async (request, { uid }) => {
    const { suggestionId } = request.data || {};
    if (typeof suggestionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(suggestionId)) {
      throw new HttpsError('invalid-argument', 'suggestionId must be a document id.');
    }

    const snap = await db.collection('recipe_edit_suggestions').doc(suggestionId).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Suggestion not found.');
    const { recipeId, storagePaths = [] } = snap.data();
    if (typeof recipeId !== 'string' || !recipeId) {
      throw new HttpsError('failed-precondition', 'Suggestion has no recipe.');
    }

    const bucket = getStorage().bucket();
    const prefix = `suggestions/${suggestionId}/`;
    const mapping = {};
    for (const entry of storagePaths) {
      const source = entry && entry.path;
      if (typeof source !== 'string' || !source.startsWith(prefix)) continue;
      const fileName = source.slice(source.lastIndexOf('/') + 1);
      const kind = entry.type === 'media' ? 'media' : 'images';
      const target = `recipes/${recipeId}/${kind}/${fileName}`;
      const [exists] = await bucket.file(target).exists();
      if (!exists) {
        await bucket.file(source).copy(bucket.file(target));
        await bucket.file(target).setMetadata({ metadata: { uploadedBy: uid } });
      }
      mapping[source] = target;
    }
    return { mapping };
  }),
);

/**
 * The family list for sharing a private recipe: name and avatar of approved
 * family and managers, for approved family and managers only. Runs server-side
 * because `users/` is readable only by its owner and managers.
 */
exports.listFamilyMembers = onCall(
  withAuthAndRole(FAMILY_ROLES, async (request, { uid }) => {
    const snap = await db.collection('users').where('role', 'in', FAMILY_ROLES).get();
    const members = familyMembers(
      snap.docs.map((d) => ({ id: d.id, data: d.data() })),
      uid,
    );
    return { members };
  }),
);

// ---------------------------------------------------------------------------
// Recipe API tokens (docs/feature-plans/recipe-api.md, slice 2) — managers issue,
// list and revoke personal tokens from the dashboard. Only these functions touch
// api_tokens (the rules deny clients). Never log a token or its hash.
// ---------------------------------------------------------------------------

exports.createApiToken = onCall(
  withAuthAndRole(['manager'], async (request, { uid: managerUid }) => {
    const input = apiTokens.validateCreateInput(request.data);
    if (!input.ok) throw new HttpsError('invalid-argument', input.message);
    const { uid, name, scope } = input.value;

    const owner = await db.collection('users').doc(uid).get();
    if (!owner.exists || !apiTokens.TOKEN_ROLES.includes(owner.get('role'))) {
      throw new HttpsError(
        'failed-precondition',
        'Tokens can only be issued to approved family or managers.',
      );
    }

    const tokens = db.collection(apiTokens.TOKENS_COLLECTION);
    const ref = tokens.doc();
    const token = apiTokens.generateToken();
    const record = apiTokens.tokenRecord({
      token,
      uid,
      name,
      scope,
      createdBy: managerUid,
      createdAt: Timestamp.now(),
    });
    // The per-user cap is checked inside the transaction, so two concurrent
    // creates can't both slip under it.
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(tokens.where('uid', '==', uid));
      if (existing.size >= apiTokens.MAX_TOKENS_PER_USER) {
        throw new HttpsError(
          'resource-exhausted',
          `A user can have at most ${apiTokens.MAX_TOKENS_PER_USER} tokens.`,
        );
      }
      tx.set(ref, record);
    });

    // The only time the secret leaves the server.
    return { token, ...apiTokens.toPublicToken(ref.id, record) };
  }),
);

exports.listApiTokens = onCall(
  withAuthAndRole(['manager'], async () => {
    const snap = await db.collection(apiTokens.TOKENS_COLLECTION).get();
    return {
      tokens: snap.docs.map((d) => apiTokens.toPublicToken(d.id, d.data())),
      maxPerUser: apiTokens.MAX_TOKENS_PER_USER,
    };
  }),
);

exports.revokeApiToken = onCall(
  withAuthAndRole(['manager'], async (request) => {
    const tokenId = request.data?.tokenId;
    if (!apiTokens.isDocId(tokenId)) {
      throw new HttpsError('invalid-argument', 'tokenId must be a token id.');
    }
    // Revoking deletes the record; deleting a missing one is a no-op.
    await db.collection(apiTokens.TOKENS_COLLECTION).doc(tokenId).delete();
    return { revoked: tokenId };
  }),
);

// Tell the managers a recipe is waiting — on a new submission, and on a
// resubmission after a rejection (an update back to pending).
async function notifyManagersOfSubmission(recipeId, { resubmitted = false } = {}) {
  let recipeName = 'מתכון חדש';
  try {
    const recipeSnap = await db.collection('recipes').doc(recipeId).get();
    recipeName = recipeSnap.get('name') || recipeName;
  } catch (error) {
    console.warn(`[submissions] could not read recipe ${recipeId}:`, error);
  }

  try {
    const result = await sendNotificationToRole('manager', {
      title: resubmitted ? 'מתכון נשלח שוב לאישור' : 'מתכון חדש ממתין לאישור',
      body: recipeName,
      collapseKey: 'recipe-approval',
      url: '/dashboard',
      data: {
        type: 'recipe-approval',
        recipeId,
      },
    });
    console.log(`[submissions] notified managers for ${recipeId}:`, result);
  } catch (error) {
    console.error(`[submissions] notification failed for ${recipeId}:`, error);
    // Don't rethrow — notification failure must not block the submission.
  }
}

/**
 * Notify managers when a recipe is submitted to the family book for approval.
 *
 * Fires on every new `recipe_submissions` document. (It used to fire on every
 * recipe create with `approved === false`; once authors keep private recipes
 * they haven't submitted, that would ping managers for every private draft.)
 *
 * One push per event for v1. Batching tracked separately.
 */
exports.onRecipeSubmitted = onDocumentCreated('recipe_submissions/{recipeId}', async (event) => {
  const submission = event.data?.data() || {};
  if (submission.status !== 'pending') return;
  await notifyManagersOfSubmission(event.params.recipeId);
});

/**
 * Notify managers when an author resubmits a rejected recipe (the submission
 * goes back to pending — an update, so onRecipeSubmitted doesn't see it).
 */
exports.onRecipeResubmitted = onDocumentUpdated('recipe_submissions/{recipeId}', async (event) => {
  const before = event.data?.before?.data() || {};
  const after = event.data?.after?.data() || {};
  if (before.status !== 'rejected' || after.status !== 'pending') return;
  await notifyManagersOfSubmission(event.params.recipeId, { resubmitted: true });
});
