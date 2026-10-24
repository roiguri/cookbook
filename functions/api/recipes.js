/**
 * Recipe API — read endpoints (docs/feature-plans/recipe-api.md §3, slice 3).
 *
 * Every read runs in the caller's user session, with the same queries as the app's
 * RecipeService, so firestore.rules / storage.rules decide what is visible. Queries
 * must satisfy the rules (published filter, authorId == me); "shared with me" recipes
 * are readable by id only.
 *
 * Through the API everyone reads like a family member — their own recipes, published
 * ones, and ones shared with them — managers included (decision 14): the rules would
 * let a manager read any private recipe, but a leaked manager token must not expose
 * every library. This only narrows what the rules allow.
 */
const { doc, getDoc, getDocs, collection, query, where } = require('firebase/firestore/lite');
const { ref, getDownloadURL } = require('firebase/storage');
const { toSummary, toFullRecipe, byNewest } = require('./format');
const { notFound, badRequest } = require('./errors');

const STAGES = ['to-try', 'tested'];

// A file that is gone or not readable has no URL; any other failure (Storage down,
// network) is an error, not a silently missing file.
const NO_FILE = ['storage/object-not-found', 'storage/unauthorized'];

const entries = (list) =>
  Array.isArray(list) ? list.filter((item) => item && typeof item === 'object') : [];

/** Download URLs for a recipe's files, as the user. */
async function resolveFiles(storage, data) {
  const url = async (path) => {
    if (typeof path !== 'string' || !path) return null;
    try {
      return await getDownloadURL(ref(storage, path));
    } catch (error) {
      if (NO_FILE.includes(error?.code)) return null;
      throw error;
    }
  };
  const images = entries(data.images);
  const media = entries(data.mediaInstructions);
  return {
    images: await Promise.all(
      images.map(async (img) => ({
        id: img.id || null,
        isPrimary: !!img.isPrimary,
        url: await url(img.full),
      })),
    ),
    mediaInstructions: await Promise.all(
      [...media]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map(async (m) => ({
          type: m.type || null,
          caption: m.caption || '',
          url: await url(m.path),
        })),
    ),
  };
}

const isPermissionDenied = (error) => error?.code === 'permission-denied';

/** Own, published, or shared with the caller (their share record, read as them). */
async function readsLikeFamily(session, recipeId, data) {
  if (data.authorId === session.uid || data.visibility === 'published') return true;
  try {
    const share = await getDoc(doc(session.db, 'recipes', recipeId, 'shares', session.uid));
    return share.exists();
  } catch (error) {
    if (isPermissionDenied(error)) return false;
    throw error;
  }
}

/**
 * The read handlers. Each gets `{ session, caller, params, query, model }`.
 */
const handlers = {
  async me({ caller }) {
    return {
      user: { name: caller.userName, role: caller.role },
      token: { name: caller.tokenName, scope: caller.scope },
    };
  },

  async categories({ model }) {
    return {
      categories: Object.entries(model.CATEGORY_MAP).map(([id, label]) => ({ id, label })),
    };
  },

  async getRecipe({ session, params, model }) {
    let snap;
    try {
      snap = await getDoc(doc(session.db, 'recipes', params.id));
    } catch (error) {
      // Not readable by this user reads the same as not there: nothing is revealed.
      if (isPermissionDenied(error)) throw notFound('Recipe not found.');
      throw error;
    }
    if (!snap.exists()) throw notFound('Recipe not found.');
    const data = snap.data();
    if (!(await readsLikeFamily(session, snap.id, data))) throw notFound('Recipe not found.');
    const files = await resolveFiles(session.storage, data);
    return toFullRecipe(snap.id, data, session.uid, model.RECIPE_CONTENT_FIELDS, files);
  },

  async listMine({ session, query: q }) {
    const stage = q.stage;
    if (stage !== undefined && !STAGES.includes(stage)) {
      throw badRequest(`stage must be one of: ${STAGES.join(', ')}.`);
    }
    const filters = [where('authorId', '==', session.uid)];
    if (stage) filters.push(where('stage', '==', stage));
    const snap = await getDocs(query(collection(session.db, 'recipes'), ...filters));
    const recipes = snap.docs.map((d) => toSummary(d.id, d.data(), session.uid)).sort(byNewest);
    return { recipes };
  },

  async listPublished({ session, query: q, model }) {
    const { category } = q;
    if (category !== undefined && !model.CATEGORY_IDS.includes(category)) {
      throw badRequest(`category must be one of: ${model.CATEGORY_IDS.join(', ')}.`);
    }
    const filters = [where('visibility', '==', 'published')];
    if (category) filters.push(where('category', '==', category));
    const snap = await getDocs(query(collection(session.db, 'recipes'), ...filters));
    const search = typeof q.q === 'string' ? q.q.trim().toLowerCase() : '';
    const recipes = snap.docs
      .map((d) => toSummary(d.id, d.data(), session.uid))
      .filter((r) => !search || r.name.toLowerCase().includes(search))
      .sort(byNewest);
    return { recipes };
  },
};

module.exports = { handlers, resolveFiles };
