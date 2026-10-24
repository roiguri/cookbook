/**
 * Recipe API — creating recipes (docs/feature-plans/recipe-api.md §3, slice 4).
 *
 * POST /v1/recipes, JSON: { id?, stage?, submit?, recipe }. The recipe is validated
 * by the shared model with the recipe form's rules — complete (decision 16), either
 * flat lists or sections of at least two (decision 15), related recipes published,
 * unique and at most four — then written in the caller's session, so firestore.rules
 * decide, exactly as for the app. Always private; `submit` also puts it in the
 * managers' queue, in the same transaction (the rules' submittedTogether). A
 * caller-supplied `id` makes retries safe: the same id again returns the existing
 * recipe unchanged (whatever the new body says) instead of a duplicate.
 * Photos and step media arrive with multipart in slice 5.
 */
const {
  doc,
  getDoc,
  collection,
  runTransaction,
  serverTimestamp,
} = require('firebase/firestore/lite');
const { ApiError, badRequest, conflict, invalid, fromFirestoreError } = require('./errors');

const BODY_FIELDS = ['id', 'stage', 'submit', 'recipe'];
const MEDIA_FIELDS = ['images', 'mediaInstructions'];
const STAGES = ['to-try', 'tested'];
// A caller-chosen document id: plain characters, not Firestore's reserved __…__ form.
const ID_FORMAT = /^(?!__)[A-Za-z0-9_-]{8,64}$/;

// Firestore stores at most 1 MiB per document, and the rules run out of memory on
// documents near that size (a misleading permission-denied). Real recipes are ~10 KB;
// refuse anything whose stored form would come near the limit, up front.
const MAX_RECIPE_BYTES = 900 * 1024;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPermissionDenied = (error) => error?.code === 'permission-denied';

/** Validate the request body (everything but the recipe content). */
function readOptions(body) {
  if (!isPlainObject(body)) throw badRequest('The body must be a JSON object.');
  const media = Object.keys(body).filter((k) => MEDIA_FIELDS.includes(k));
  if (media.length) {
    throw badRequest('Photos and step media are not supported by this endpoint yet.');
  }
  const unknown = Object.keys(body).filter((k) => !BODY_FIELDS.includes(k));
  if (unknown.length) {
    throw invalid(
      'invalid-request',
      'The request has unknown fields.',
      unknown.map((field) => ({ field, message: 'unknown field' })),
    );
  }
  const { id, stage = 'to-try', submit = false } = body;
  if (id !== undefined && !(typeof id === 'string' && ID_FORMAT.test(id))) {
    throw badRequest('id must be 8–64 letters, digits, "_" or "-".');
  }
  if (!STAGES.includes(stage)) throw badRequest(`stage must be one of: ${STAGES.join(', ')}.`);
  if (typeof submit !== 'boolean') throw badRequest('submit must be true or false.');
  if (body.recipe === undefined) throw badRequest('recipe is required.');
  return { id, stage, submit };
}

/**
 * The write handlers. Each gets `{ session, caller, body, model, setStatus }`.
 */
const handlers = {
  async createRecipe({ session, caller, body, model, setStatus }) {
    const { id, stage, submit } = readOptions(body);

    const content = model.normalizeRecipeContent(body.recipe);
    if (!content.ok) {
      throw invalid('invalid-recipe', 'The recipe has invalid fields.', content.errors);
    }
    // Every recipe must be complete, as the form requires of every save (decision 16).
    const missing = model.missingRequiredFields(content.recipe);
    if (missing.length) {
      throw invalid(
        'incomplete-recipe',
        'The recipe must be complete, as in the recipe form.',
        missing.map((field) => ({ field, message: 'is required' })),
      );
    }

    const { db, uid } = session;
    const ref = id ? doc(db, 'recipes', id) : doc(collection(db, 'recipes'));
    const related = content.recipe.relatedRecipes || [];
    if (related.includes(ref.id)) {
      throw invalid('invalid-recipe', 'The recipe has invalid fields.', [
        { field: 'relatedRecipes', message: 'cannot link the recipe to itself' },
      ]);
    }
    // Owner, visibility and stage come from here, never from the request.
    const data = model.withModelFields({
      ...content.recipe,
      authorId: uid,
      visibility: 'private',
      stage,
    });
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_RECIPE_BYTES) {
      throw new ApiError(400, 'recipe-too-large', 'The recipe is too large to store.');
    }
    data.creationTime = serverTimestamp();
    data.createdVia = { kind: 'api', tokenId: caller.tokenId };

    let outcome;
    try {
      outcome = await runTransaction(db, async (tx) => {
        let existing;
        try {
          existing = await tx.get(ref);
        } catch (error) {
          // Someone else's private recipe: the id is taken.
          if (isPermissionDenied(error)) throw conflict('This id belongs to another recipe.');
          throw error;
        }
        if (existing.exists()) {
          if (existing.get('authorId') !== uid) {
            throw conflict('This id belongs to another recipe.');
          }
          return { created: false, stage: existing.get('stage') };
        }
        // Related recipes: published ones only, as the form offers (read as the user).
        const badLinks = [];
        for (const [i, relatedId] of related.entries()) {
          const linked = await tx.get(doc(db, 'recipes', relatedId)).catch((error) => {
            if (isPermissionDenied(error)) return null;
            throw error;
          });
          if (!linked?.exists() || linked.get('visibility') !== 'published') {
            badLinks.push({ field: `relatedRecipes[${i}]`, message: 'must be a published recipe' });
          }
        }
        if (badLinks.length) {
          throw invalid('invalid-recipe', 'The recipe has invalid fields.', badLinks);
        }
        tx.set(ref, data);
        if (submit) {
          tx.set(
            doc(db, 'recipe_submissions', ref.id),
            model.submissionRecord({
              recipeId: ref.id,
              authorId: uid,
              createdAt: serverTimestamp(),
            }),
          );
        }
        return { created: true, stage };
      });
    } catch (error) {
      throw fromFirestoreError(error);
    }

    let submitted = submit;
    if (!outcome.created) {
      // A retry never changes the recipe. Report it as it is — and refuse a retry that
      // asks to submit a recipe that was saved without a submission.
      submitted = await hasSubmission(db, ref.id);
      if (submit && !submitted) {
        throw conflict(
          'This id was already saved without sending it for approval; send it from the app.',
        );
      }
    }
    setStatus(outcome.created ? 201 : 200);
    return {
      id: ref.id,
      path: `/recipe/${ref.id}`,
      stage: outcome.stage === 'to-try' ? 'to-try' : 'tested',
      submitted,
      created: outcome.created,
    };
  },
};

/**
 * Whether the caller's recipe has a submission. The rules refuse reading a missing
 * submission (their read check needs the document), so permission-denied means none.
 */
async function hasSubmission(db, recipeId) {
  try {
    return (await getDoc(doc(db, 'recipe_submissions', recipeId))).exists();
  } catch (error) {
    if (isPermissionDenied(error)) return false;
    throw error;
  }
}

module.exports = { handlers, readOptions, ID_FORMAT };
