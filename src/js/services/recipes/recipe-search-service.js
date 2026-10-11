// src/js/services/recipes/recipe-search-service.js

import { RecipeService, VISIBILITY } from './recipe-service.js';
import { RecipeSubmissionService } from './recipe-submission-service.js';

/**
 * RecipeSearchService — what a search looks through
 *
 * Searching (the header search, or the Categories search box) covers the family
 * book and, for a reader with a library of their own (approved family,
 * managers), their own private recipes too — badged (to try / private /
 * pending / rejected). Browsing without a search stays the family book only.
 *
 * Firestore can't express "published OR mine" in one query, so it's two
 * queries merged here — the one place that does it.
 *
 * Public API:
 *   - listSearchable({ category, ownerId })
 */
export class RecipeSearchService {
  /**
   * @param {Object} [params]
   * @param {string} [params.category='all'] - Limit to one category.
   * @param {string|null} [params.ownerId] - The reader's uid, when their own
   *   private recipes should be included (approved family and managers only).
   * @returns {Promise<Array<Object>>} Own private recipes first, then the family book.
   */
  static async listSearchable({ category = 'all', ownerId = null } = {}) {
    const inCategory = category && category !== 'all';
    const [published, mine] = await Promise.all([
      RecipeService.listPublished({ where: inCategory ? [['category', '==', category]] : [] }),
      ownerId ? RecipeSubmissionService.listMineWithStatus(ownerId).catch(() => []) : [],
    ]);
    // Own published recipes are already in the family book.
    const ownPrivate = mine.filter(
      (r) => r.visibility !== VISIBILITY.PUBLISHED && (!inCategory || r.category === category),
    );
    return [...ownPrivate, ...published];
  }
}
