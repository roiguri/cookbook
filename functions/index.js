const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const {
  extractRecipeFromImage,
  extractRecipeFromUrl,
  enhanceFoodImage,
  PARAMETER_TAXONOMY,
} = require('./utils/gemini-service');
const { sendNotificationToRole } = require('./notifications');

// Initialize Firebase Admin
initializeApp();
const db = getFirestore();

// Pub/Sub recipe-transfer pipeline (currently gated, see #202). Whole
// implementation lives in ./recipe-transfer.js so this file stays lean.
exports.processRecipeTransfer = require('./recipe-transfer.js').processRecipeTransfer;

async function logFailedUrlExtraction(url, error, userId) {
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
      });
    } else {
      await collectionRef.add({
        url: url,
        count: 1,
        firstAttempt: Timestamp.now(),
        lastAttempt: Timestamp.now(),
        error: errorData,
        lastUserId: userId,
      });
    }
  } catch (logError) {
    console.error('Failed to log failed URL extraction:', logError);
  }
}

exports.extractRecipeFromImage = onCall({ secrets: ['GEMINI_API_KEY'] }, async (request) => {
  // Check if user is authenticated
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  const { uid, token } = request.auth;
  const { images } = request.data;

  // Verify inputs
  if (!images || !Array.isArray(images) || images.length === 0) {
    throw new HttpsError('invalid-argument', 'The function must be called with an images array.');
  }

  try {
    // Check for approved/manager role
    // We can check the custom claims in the token or fetch the user from Firestore
    // For performance, checking claims is better if they are set.
    // Fallback to Firestore if needed or if claims aren't fully trusted for this op.

    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      throw new HttpsError('permission-denied', 'User not found.');
    }

    const userData = userDoc.data();
    const role = userData.role;

    if (role !== 'approved' && role !== 'manager') {
      throw new HttpsError(
        'permission-denied',
        'User must be approved or a manager to use this feature.',
      );
    }

    const recipeData = await extractRecipeFromImage(images);
    return recipeData;
  } catch (error) {
    console.error('Error extracting recipe:', error);
    // Re-throw HTTPS errors as-is
    if (error.code && error.details) {
      throw error;
    }
    throw new HttpsError('internal', 'Recipe extraction failed', error.message);
  }
});

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

exports.enhanceFoodImage = onCall({ secrets: ['GEMINI_API_KEY'] }, async (request) => {
  // Check if user is authenticated
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  const { uid } = request.auth;
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
    // Role gate — managers only.
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      throw new HttpsError('permission-denied', 'User not found.');
    }

    const role = userDoc.data().role;
    if (role !== 'manager') {
      throw new HttpsError('permission-denied', 'User must be a manager to use this feature.');
    }

    return await enhanceFoodImage({ image, parameters, instruction });
  } catch (error) {
    console.error('Error enhancing image:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Image enhancement failed');
  }
});

exports.extractRecipeFromUrl = onCall({ secrets: ['GEMINI_API_KEY'] }, async (request) => {
  // Check if user is authenticated
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  const { uid } = request.auth;
  const { url } = request.data;

  // Verify inputs
  if (!url || typeof url !== 'string') {
    throw new HttpsError(
      'invalid-argument',
      'The function must be called with a valid URL string.',
    );
  }

  // Validate URL format
  try {
    new URL(url);
  } catch (urlError) {
    throw new HttpsError('invalid-argument', 'Invalid URL format provided.');
  }

  try {
    // Check for approved/manager role
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      throw new HttpsError('permission-denied', 'User not found.');
    }

    const userData = userDoc.data();
    const role = userData.role;

    if (role !== 'approved' && role !== 'manager') {
      throw new HttpsError(
        'permission-denied',
        'User must be approved or a manager to use this feature.',
      );
    }

    const recipeData = await extractRecipeFromUrl(url);
    return recipeData;
  } catch (error) {
    console.error('Error extracting recipe from URL:', error);

    // Log the failure
    await logFailedUrlExtraction(url, error, uid);

    // Re-throw HTTPS errors as-is
    if (error.code && error.details) {
      throw error;
    }
    throw new HttpsError('internal', 'Recipe extraction from URL failed', error.message);
  }
});

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
