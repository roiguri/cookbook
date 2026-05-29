const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const {
  extractRecipeFromImage,
  extractRecipeFromUrl,
  extractRecipeFromVideo,
  enhanceFoodImage,
  PARAMETER_TAXONOMY,
} = require('./utils/gemini-service');
const { withAuthAndRole } = require('./utils/guards');
const { sendNotificationToRole } = require('./notifications');

// Initialize Firebase Admin
initializeApp();
const db = getFirestore();

// Pub/Sub recipe-transfer pipeline (currently gated, see #202). Whole
// implementation lives in ./recipe-transfer.js so this file stays lean.
exports.processRecipeTransfer = require('./recipe-transfer.js').processRecipeTransfer;

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
 * Notify managers when a new recipe is submitted for approval.
 *
 * Fires on every recipe create; only sends when `approved === false` so it
 * skips manager-authored recipes that are created already-approved and the
 * processRecipeTransfer pipeline (which also lands recipes with approved=false
 * — that's intentional, those should be reviewed too).
 *
 * One push per event for v1. Batching tracked separately.
 */
exports.onRecipeCreated = onDocumentCreated('recipes/{recipeId}', async (event) => {
  const snap = event.data;
  if (!snap) return;
  const recipe = snap.data() || {};
  if (recipe.approved === true) return;

  const recipeId = event.params.recipeId;
  const recipeName = recipe.name || 'מתכון חדש';

  try {
    const result = await sendNotificationToRole('manager', {
      title: 'מתכון חדש ממתין לאישור',
      body: recipeName,
      collapseKey: 'recipe-approval',
      url: '/dashboard',
      data: {
        type: 'recipe-approval',
        recipeId,
      },
    });
    console.log(`[onRecipeCreated] notified managers for ${recipeId}:`, result);
  } catch (error) {
    console.error(`[onRecipeCreated] notification failed for ${recipeId}:`, error);
    // Don't rethrow — notification failure must not block the recipe creation.
  }
});
