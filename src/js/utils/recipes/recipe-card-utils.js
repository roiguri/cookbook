/*
 * Recipe Card Utilities
 * ---------------------
 * Pure helpers for building the denormalised `card` map stored on a
 * `users/{uid}/collection/{recipeId}` entry. No I/O, no service/SDK imports.
 *
 * Exported:
 *   - buildCardFromRecipe(recipe): Build the { name, category, primaryImage,
 *     prepTime } map CollectionService documents from a full recipe doc.
 */

import { getPrimaryImage } from './recipe-image-utils.js';

/**
 * Builds the denormalised card map CollectionService.create()/update()
 * expect, matching the shape `favorites-service.js`'s buildCard() writes.
 * @param {Object} recipe
 * @returns {Object}
 */
export function buildCardFromRecipe(recipe) {
  const card = {
    name: recipe.name ?? null,
    category: recipe.category ?? null,
    prepTime: recipe.prepTime ?? null,
  };
  const primary = getPrimaryImage(recipe);
  if (primary?.full) {
    card.primaryImage = primary.full;
  }
  return card;
}
