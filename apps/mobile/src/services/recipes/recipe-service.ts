import AsyncStorage from '@react-native-async-storage/async-storage';
import { STAGE, VISIBILITY, withModelFields } from '@cookbook/core/recipe-model';
import {
  deleteDocument,
  generateDocId,
  getDocument,
  limit as fsLimit,
  listDocuments,
  orderBy as fsOrderBy,
  serverTimestamp,
  setDocument,
  updateDocument,
  where,
  type QueryConstraint,
} from '../_firebase/firestore-adapter';
import { captureError } from '../logger';
import { RecipeImageService } from './recipe-image-service';

export { STAGE, VISIBILITY };

export interface RecipeImageEntry {
  id?: string;
  full?: string;
  url?: string;
  fileName?: string;
  isPrimary?: boolean;
  uploadedBy?: string;
  access?: string;
  uploadTimestamp?: any;
  preview?: string;
}

export interface RecipeDoc {
  id: string;
  name: string;
  category: string;
  description?: string;
  attribution?: string;
  difficulty?: string;
  prepTime?: number;
  waitTime?: number;
  servings?: number;
  servingsUnit?: string;
  mainIngredient?: string;
  tags?: string[];
  ingredients?: any[];
  ingredientSections?: any[];
  instructions?: string[];
  stages?: Array<{ title: string; instructions: string[] }>;
  mediaInstructions?: any[];
  comments?: string[];
  images?: RecipeImageEntry[];
  relatedRecipes?: string[];
  visibility?: 'published' | 'private';
  stage?: 'to-try' | 'tested';
  authorId?: string | null;
  authorName?: string;
  source?: string;
  creationTime?: any;
  updatedAt?: any;
  testedAt?: any;
  // View-enriched metadata attached by search / My Recipes / sharing
  submissionStatus?: 'pending' | 'approved' | 'rejected' | string;
  ownView?: boolean;
  sharedBy?: { uid?: string; name?: string; sharedAt?: any } | null;
}

const RECIPES_COLLECTION = 'recipes';
const CACHE_RECIPE_PREFIX = 'cookbook:cache:recipe:';
const CACHE_PUBLISHED_PREFIX = 'cookbook:cache:recipes:published:';
const CACHE_MINE_PREFIX = 'cookbook:cache:recipes:mine:';

function getTimestampMillis(value: any): number {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function sortByNewest(recipes: RecipeDoc[]): RecipeDoc[] {
  return [...recipes].sort(
    (a, b) => getTimestampMillis(b.creationTime) - getTimestampMillis(a.creationTime),
  );
}

function stripUndefined(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      out[key] = value.filter((item) => item !== undefined);
    } else {
      out[key] = value;
    }
  }
  return out;
}

async function writeCache<T>(key: string, data: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // Offline cache write is best-effort
  }
}

async function readCache<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed?.data as T) ?? null;
  } catch {
    return null;
  }
}

async function removeCache(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // Best-effort
  }
}

export const RecipeService = {
  generateId(): string {
    return generateDocId(RECIPES_COLLECTION);
  },

  /**
   * Fetch a single recipe by ID with AsyncStorage offline fallback (INV-P1-03).
   */
  async getById(id: string): Promise<RecipeDoc | null> {
    if (!id) return null;
    const cacheKey = `${CACHE_RECIPE_PREFIX}${id}`;
    try {
      const doc = await getDocument<RecipeDoc>(RECIPES_COLLECTION, id);
      if (doc) {
        void writeCache(cacheKey, doc);
      }
      return doc;
    } catch (err) {
      const cached = await readCache<RecipeDoc>(cacheKey);
      if (cached) return cached;

      // Secondary offline fallback: look up inside cached published list
      const cachedPublished = await readCache<RecipeDoc[]>(`${CACHE_PUBLISHED_PREFIX}all`);
      const match = cachedPublished?.find((r) => r.id === id) || null;
      if (match) return match;

      captureError(err, { service: 'recipe', op: 'getById', recipeId: id });
      throw err;
    }
  },

  /**
   * Alias matching Web `RecipeService.get`.
   */
  async get(id: string): Promise<RecipeDoc | null> {
    return RecipeService.getById(id);
  },

  /**
   * List published recipes with optional category filter, ordering, limit,
   * and AsyncStorage offline fallback (INV-P1-03).
   */
  async listPublished(opts?: {
    category?: string;
    limit?: number;
    orderBy?: [string, 'asc' | 'desc'];
  }): Promise<RecipeDoc[]> {
    const category = opts?.category && opts.category !== 'all' ? opts.category : 'all';
    const hasCategory = category !== 'all';
    const cacheKey =
      opts?.limit && !hasCategory
        ? `${CACHE_PUBLISHED_PREFIX}featured:${opts.limit}`
        : `${CACHE_PUBLISHED_PREFIX}${category}`;

    try {
      let recipes: RecipeDoc[];

      if (!hasCategory && (opts?.orderBy || opts?.limit)) {
        const orderField = opts?.orderBy?.[0] || 'creationTime';
        const orderDir = opts?.orderBy?.[1] || 'desc';
        const constraints: QueryConstraint[] = [
          where('visibility', '==', VISIBILITY.PUBLISHED),
          fsOrderBy(orderField, orderDir),
        ];
        if (opts?.limit && opts.limit > 0) {
          constraints.push(fsLimit(opts.limit));
        }

        try {
          recipes = await listDocuments<RecipeDoc>(RECIPES_COLLECTION, constraints);
          // Fallback if docs lack creationTime and ordered query returned empty
          if (recipes.length === 0 && orderField === 'creationTime') {
            const allPublished = await listDocuments<RecipeDoc>(RECIPES_COLLECTION, [
              where('visibility', '==', VISIBILITY.PUBLISHED),
            ]);
            const sorted = sortByNewest(allPublished);
            recipes = opts?.limit && opts.limit > 0 ? sorted.slice(0, opts.limit) : sorted;
          }
        } catch {
          const allPublished = await listDocuments<RecipeDoc>(RECIPES_COLLECTION, [
            where('visibility', '==', VISIBILITY.PUBLISHED),
          ]);
          const sorted = sortByNewest(allPublished);
          recipes = opts?.limit && opts.limit > 0 ? sorted.slice(0, opts.limit) : sorted;
        }
      } else {
        const constraints: QueryConstraint[] = [where('visibility', '==', VISIBILITY.PUBLISHED)];
        if (hasCategory) {
          constraints.push(where('category', '==', category));
        }
        const docs = await listDocuments<RecipeDoc>(RECIPES_COLLECTION, constraints);
        const sorted = sortByNewest(docs);
        recipes = opts?.limit && opts.limit > 0 ? sorted.slice(0, opts.limit) : sorted;
      }

      // Defensive P0 guard: ensure only published docs ever leave listPublished
      const safePublished = recipes.filter((r) => r.visibility === VISIBILITY.PUBLISHED);
      void writeCache(cacheKey, safePublished);
      return safePublished;
    } catch (err) {
      const cached = await readCache<RecipeDoc[]>(cacheKey);
      if (cached) {
        return opts?.limit && opts.limit > 0 ? cached.slice(0, opts.limit) : cached;
      }

      if (hasCategory) {
        const allCached = await readCache<RecipeDoc[]>(`${CACHE_PUBLISHED_PREFIX}all`);
        if (allCached) {
          const filtered = allCached.filter((r) => r.category === category);
          return opts?.limit && opts.limit > 0 ? filtered.slice(0, opts.limit) : filtered;
        }
      }

      captureError(err, { service: 'recipe', op: 'listPublished', category });
      throw err;
    }
  },

  /**
   * Manager view: list all recipes regardless of visibility.
   */
  async listAll(): Promise<RecipeDoc[]> {
    const docs = await listDocuments<RecipeDoc>(RECIPES_COLLECTION);
    return sortByNewest(docs);
  },

  /**
   * List recipes authored by `uid`, sorted newest first, with optional stage/category filter.
   * Equality constraints only (no composite index required).
   */
  async listMine(
    uid: string,
    opts?: { stage?: 'to-try' | 'tested'; category?: string },
  ): Promise<RecipeDoc[]> {
    if (!uid) return [];
    const stageKey = opts?.stage || 'all';
    const catKey = opts?.category && opts.category !== 'all' ? opts.category : 'all';
    const cacheKey = `${CACHE_MINE_PREFIX}${uid}:${stageKey}:${catKey}`;

    const constraints: QueryConstraint[] = [where('authorId', '==', uid)];
    if (opts?.stage) {
      constraints.push(where('stage', '==', opts.stage));
    }
    if (opts?.category && opts.category !== 'all') {
      constraints.push(where('category', '==', opts.category));
    }

    try {
      const docs = await listDocuments<RecipeDoc>(RECIPES_COLLECTION, constraints);
      const sorted = sortByNewest(docs);
      void writeCache(cacheKey, sorted);
      return sorted;
    } catch (err) {
      const cached = await readCache<RecipeDoc[]>(cacheKey);
      if (cached) return cached;
      captureError(err, { service: 'recipe', op: 'listMine', uid });
      throw err;
    }
  },

  /**
   * Create a recipe document (applying shared `withModelFields` defaults).
   */
  async create(data: Record<string, any>, id?: string): Promise<string> {
    if (!data || typeof data !== 'object') {
      throw new Error('RecipeService.create: data is required');
    }
    const recipeId = id || generateDocId(RECIPES_COLLECTION);
    const cleaned = stripUndefined(data);
    delete cleaned.id;

    const normalized = withModelFields(cleaned);
    const payload: Record<string, any> = {
      ...normalized,
      creationTime: normalized.creationTime ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDocument(RECIPES_COLLECTION, payload, { merge: false }, recipeId);
    return recipeId;
  },

  /**
   * Patch-update an existing recipe document.
   * Preserves `firestore.rules` author stage-only updates by omitting `updatedAt`
   * when only `stage` / `testedAt` are being written.
   */
  async update(id: string, data: Record<string, any>): Promise<void> {
    if (!id) throw new Error('RecipeService.update: id is required');
    const cleaned = stripUndefined(data);
    delete cleaned.id;

    const keys = Object.keys(cleaned);
    const isStageOnlyUpdate =
      keys.length > 0 && keys.every((k) => k === 'stage' || k === 'testedAt');

    const payload = isStageOnlyUpdate
      ? cleaned
      : {
          ...cleaned,
          updatedAt: serverTimestamp(),
        };

    await updateDocument(RECIPES_COLLECTION, payload, id);
    void removeCache(`${CACHE_RECIPE_PREFIX}${id}`);
  },

  /**
   * Delete a recipe document and best-effort clean up its Storage images.
   */
  async delete(id: string): Promise<void> {
    if (!id) throw new Error('RecipeService.delete: id is required');
    try {
      const existing = await getDocument<RecipeDoc>(RECIPES_COLLECTION, id);
      if (existing?.images?.length) {
        await RecipeImageService.deleteRecipeImages(id, existing.images).catch(() => {});
      }
    } catch {
      // Best-effort image cleanup before document delete
    }
    await deleteDocument(RECIPES_COLLECTION, id);
    void removeCache(`${CACHE_RECIPE_PREFIX}${id}`);
  },

  /**
   * Mark an author's recipe as tested (`stage: 'tested', testedAt: serverTimestamp()`).
   * Writes ONLY `stage` and `testedAt` so authors can toggle stage on published recipes too.
   */
  async markTested(id: string): Promise<void> {
    if (!id) throw new Error('RecipeService.markTested: id is required');
    await updateDocument(
      RECIPES_COLLECTION,
      {
        stage: STAGE.TESTED,
        testedAt: serverTimestamp(),
      },
      id,
    );
    void removeCache(`${CACHE_RECIPE_PREFIX}${id}`);
  },

  /**
   * Move an author's recipe back to "to try" (`stage: 'to-try', testedAt: null`).
   * Writes ONLY `stage` and `testedAt` to satisfy `firestore.rules` author stage updates.
   */
  async markToTry(id: string): Promise<void> {
    if (!id) throw new Error('RecipeService.markToTry: id is required');
    await updateDocument(
      RECIPES_COLLECTION,
      {
        stage: STAGE.TO_TRY,
        testedAt: null,
      },
      id,
    );
    void removeCache(`${CACHE_RECIPE_PREFIX}${id}`);
  },
};
