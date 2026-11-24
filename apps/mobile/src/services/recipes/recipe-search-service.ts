import { FilterUtils } from '@cookbook/core/filter-utils';
import { VISIBILITY } from '@cookbook/core/recipe-model';
import { listDocuments, where } from '../_firebase/firestore-adapter';
import { captureError } from '../logger';
import { RecipeService, type RecipeDoc } from './recipe-service';

interface SubmissionStatusDoc {
  id: string;
  recipeId?: string;
  status?: string;
}

const SUBMISSIONS_COLLECTION = 'recipe_submissions';

function canSearchOwnPrivate(role: string, uid?: string | null): uid is string {
  return Boolean(uid) && (role === 'approved' || role === 'manager');
}

export const RecipeSearchService = {
  /**
   * Author's own recipes enriched with `submissionStatus` from `recipe_submissions`
   * and `ownView: true`, so cards display full status badges (`לנסות`/`פרטי`/`ממתין`/`נדחה`).
   */
  async listMineWithStatus(uid: string): Promise<RecipeDoc[]> {
    if (!uid) return [];
    const [mine, submissions] = await Promise.all([
      RecipeService.listMine(uid),
      listDocuments<SubmissionStatusDoc>(SUBMISSIONS_COLLECTION, [
        where('authorId', '==', uid),
      ]).catch(() => [] as SubmissionStatusDoc[]),
    ]);

    const statusByRecipeId = new Map<string, string>();
    for (const sub of submissions) {
      const targetId = sub.recipeId || sub.id;
      if (targetId && typeof sub.status === 'string') {
        statusByRecipeId.set(targetId, sub.status);
      }
    }

    return mine.map((recipe) => ({
      ...recipe,
      submissionStatus: statusByRecipeId.get(recipe.id),
      ownView: true,
    }));
  },

  /**
   * Fetch searchable recipe pool:
   * - Guests & plain `user`: published recipes ONLY (INV-P0-01 / INV-P0-03).
   * - `approved` & `manager`: caller's own private recipes FIRST (with status badges),
   *   followed by published recipes (deduplicated).
   */
  async listSearchable(opts: {
    role: string;
    uid?: string | null;
    category?: string;
    publishedRecipes?: RecipeDoc[];
  }): Promise<{ recipes: RecipeDoc[]; privateIds: Set<string> }> {
    const category = opts.category && opts.category !== 'all' ? opts.category : 'all';
    const inCategory = category !== 'all';

    const publishedPromise = opts.publishedRecipes
      ? Promise.resolve(
          opts.publishedRecipes.filter(
            (r) =>
              r.visibility === VISIBILITY.PUBLISHED && (!inCategory || r.category === category),
          ),
        )
      : RecipeService.listPublished(inCategory ? { category } : {});

    if (!canSearchOwnPrivate(opts.role, opts.uid)) {
      const published = await publishedPromise;
      return { recipes: published, privateIds: new Set<string>() };
    }

    const [published, mineWithStatus] = await Promise.all([
      publishedPromise,
      RecipeSearchService.listMineWithStatus(opts.uid).catch((err) => {
        captureError(err, { service: 'recipe-search', op: 'listMineWithStatus', uid: opts.uid });
        return [] as RecipeDoc[];
      }),
    ]);

    // Caller's own private recipes first (own published recipes are already in `published`)
    const ownPrivate = mineWithStatus.filter(
      (r) => r.visibility !== VISIBILITY.PUBLISHED && (!inCategory || r.category === category),
    );

    const privateIds = new Set<string>(ownPrivate.map((r) => r.id));
    const dedupedPublished = published.filter((r) => !privateIds.has(r.id));

    return {
      recipes: [...ownPrivate, ...dedupedPublished],
      privateIds,
    };
  },

  /**
   * Unified search using `@cookbook/core/filter-utils` `FilterUtils.searchRecipes`:
   * - Empty query: published recipes only (never leaks private recipes when browsing).
   * - Non-empty query:
   *   - Guest & plain `user`: searches published recipes ONLY.
   *   - `approved` & `manager`: merges caller's own private recipes FIRST (badged),
   *     ahead of matching published recipes.
   */
  async searchUnified(
    query: string,
    opts: {
      role: string;
      uid?: string | null;
      category?: string;
      publishedRecipes?: RecipeDoc[];
    },
  ): Promise<{ recipes: RecipeDoc[]; privateIds: Set<string> }> {
    const trimmed = (query || '').trim();
    const category = opts.category && opts.category !== 'all' ? opts.category : 'all';
    const inCategory = category !== 'all';

    if (!trimmed) {
      const published = opts.publishedRecipes
        ? opts.publishedRecipes.filter(
            (r) =>
              r.visibility === VISIBILITY.PUBLISHED && (!inCategory || r.category === category),
          )
        : await RecipeService.listPublished(inCategory ? { category } : {});
      return { recipes: published, privateIds: new Set<string>() };
    }

    const { recipes: pool, privateIds } = await RecipeSearchService.listSearchable({
      role: opts.role,
      uid: opts.uid,
      category,
      publishedRecipes: opts.publishedRecipes,
    });

    const matched = FilterUtils.searchRecipes(pool, trimmed) as RecipeDoc[];
    const matchedPrivateIds = new Set<string>(
      matched.filter((r) => privateIds.has(r.id)).map((r) => r.id),
    );

    return {
      recipes: matched,
      privateIds: matchedPrivateIds,
    };
  },
};
