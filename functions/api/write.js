/**
 * Recipe API — creating recipes (docs/feature-plans/recipe-api.md §3, slices 4–5).
 *
 * POST /v1/recipes, as JSON `{ id?, stage?, submit?, recipe }`, or as multipart with that
 * JSON in a `request` part plus photos and step media (`images` / `mediaInstructions`
 * entries naming file parts — see media.js). The recipe is validated by the shared model
 * with the recipe form's rules — complete (decision 16), flat lists or sections of at
 * least two (decision 15), related recipes published, unique and at most four — and the
 * files by the app's file rules. Everything is then written in the caller's session, so
 * firestore.rules / storage.rules decide, exactly as for the app. Always private;
 * `submit` also puts it in the managers' queue in the same transaction (the rules'
 * submittedTogether). A caller-supplied `id` makes retries safe: the same id again
 * returns the existing recipe unchanged (whatever the new body says), and uploads
 * nothing.
 */
const {
  doc,
  getDoc,
  collection,
  runTransaction,
  serverTimestamp,
} = require('firebase/firestore/lite');
const { ApiError, badRequest, conflict, invalid, fromFirestoreError } = require('./errors');
const { planUploads } = require('./media');
const { uploadPlanned, removeFiles } = require('./uploads');

const BODY_FIELDS = ['id', 'stage', 'submit', 'recipe'];
const MEDIA_FIELDS = ['images', 'mediaInstructions'];
const STAGES = ['to-try', 'tested'];
// A caller-chosen document id: plain characters, not Firestore's reserved __…__ form.
const ID_FORMAT = /^(?!__)[A-Za-z0-9_-]{8,64}$/;

// Firestore stores at most 1 MiB per document, and the rules run out of memory on
// documents near that size (a misleading permission-denied). Real recipes are ~10 KB;
// refuse anything whose stored form would come near the limit, up front.
const MAX_RECIPE_BYTES = 900 * 1024;
// Generous size of one image / media entry without its caption (paths, ids, times).
const FILE_ENTRY_BYTES = 512;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPermissionDenied = (error) => error?.code === 'permission-denied';
const taken = () => conflict('This id belongs to another recipe.');

/**
 * Validate the request body (everything but the recipe content and the files).
 * @param {*} body
 * @param {boolean} multipart - Files may only come with multipart.
 */
function readOptions(body, multipart) {
  if (!isPlainObject(body)) throw badRequest('The body must be a JSON object.');
  if (!multipart && Object.keys(body).some((k) => MEDIA_FIELDS.includes(k))) {
    throw badRequest('Send photos and step media as multipart/form-data.');
  }
  const allowed = multipart ? [...BODY_FIELDS, ...MEDIA_FIELDS] : BODY_FIELDS;
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
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
 * The caller's existing recipe at `ref`, as `{ stage, images, mediaInstructions }`, or
 * null if there is none; someone else's recipe there is a conflict.
 */
function existingOutcome(snap, uid) {
  if (!snap.exists()) return null;
  if (snap.get('authorId') !== uid) throw taken();
  const count = (list) => (Array.isArray(list) ? list.length : 0);
  return {
    created: false,
    stage: snap.get('stage'),
    images: count(snap.get('images')),
    mediaInstructions: count(snap.get('mediaInstructions')),
  };
}

/** Read a recipe by id, as the user; someone else's private recipe is a conflict. */
async function readOwn(read, ref) {
  try {
    return await read(ref);
  } catch (error) {
    if (isPermissionDenied(error)) throw taken();
    throw error;
  }
}

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

/**
 * Related recipes must be published ones, as the form offers — read as the user, with
 * `read` (getDoc, or a transaction's get).
 */
async function checkRelated(db, related, read) {
  const badLinks = [];
  for (const [i, relatedId] of related.entries()) {
    const linked = await read(doc(db, 'recipes', relatedId)).catch((error) => {
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
}

/**
 * The write handlers. Each gets `{ session, caller, body, files, model, setStatus }`
 * (`files`: the multipart file parts, or null for JSON).
 */
const handlers = {
  async createRecipe({ session, caller, body, files, model, setStatus }) {
    const { id, stage, submit } = readOptions(body, !!files);

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
    const plan = files ? planUploads(body, files, model) : { images: [], media: [] };

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
    // Before any upload: the files' entries (captions included) count toward the size.
    const filesBytes =
      plan.media.reduce((sum, m) => sum + Buffer.byteLength(m.caption, 'utf8'), 0) +
      FILE_ENTRY_BYTES * (plan.images.length + plan.media.length);
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') + filesBytes > MAX_RECIPE_BYTES) {
      throw new ApiError(400, 'recipe-too-large', 'The recipe is too large to store.');
    }

    // Files: a retry or someone else's id is settled before anything is uploaded.
    let uploaded = [];
    let outcome = null;
    if (plan.images.length || plan.media.length) {
      outcome = existingOutcome(await readOwn((r) => getDoc(r), ref), uid);
      if (!outcome) {
        // Before uploading, so a bad link doesn't cost an upload (and leave thumbnails).
        await checkRelated(db, related, (r) => getDoc(r));
        const stored = await uploadPlanned(session, ref.id, plan, model);
        uploaded = stored.uploaded;
        if (stored.images.length) data.images = stored.images;
        if (stored.mediaInstructions.length) data.mediaInstructions = stored.mediaInstructions;
      }
    }
    data.creationTime = serverTimestamp();
    data.createdVia = { kind: 'api', tokenId: caller.tokenId };

    if (!outcome) {
      try {
        outcome = await runTransaction(db, async (tx) => {
          const existing = existingOutcome(await readOwn((r) => tx.get(r), ref), uid);
          if (existing) return existing;
          // Again in the write, in case a related recipe changed since the check above.
          await checkRelated(db, related, (r) => tx.get(r));
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
          return {
            created: true,
            stage,
            images: data.images?.length || 0,
            mediaInstructions: data.mediaInstructions?.length || 0,
          };
        });
      } catch (error) {
        await removeFiles(session, uploaded);
        throw fromFirestoreError(error);
      }
      // Lost a race to a concurrent request with the same id: its files stay, ours go.
      if (!outcome.created) await removeFiles(session, uploaded);
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
      images: outcome.images,
      mediaInstructions: outcome.mediaInstructions,
    };
  },
};

module.exports = { handlers, readOptions, ID_FORMAT };
