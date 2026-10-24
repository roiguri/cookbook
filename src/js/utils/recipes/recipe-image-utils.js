/*
 * Recipe Image Utilities
 * ---------------------
 * Pure helpers for recipe-image handling. No I/O, no service/SDK imports.
 *
 * Exported:
 *
 * Validation:
 *   - validateImageFile(file): Validate file type and size.
 *
 * Storage Path Helpers:
 *   - getImageStoragePath(recipeId, fileName): Path of a recipe image (see storage-paths.js).
 *   - generateImageId(): Generate a unique image ID.
 *
 * Access / Selection:
 *   - getRecipeImages(recipe, userRole): Filter images by access level for a user role.
 *   - getPrimaryImage(recipe): Pick the primary (or first) image object.
 *   - getPlaceholderImageUrl(): Returns null (sentinel for "no image").
 */

import { recipeImagesFolder } from './storage-paths.js';

/**
 * @typedef {Object} RecipeImage
 * @property {string} id
 * @property {string} full
 * @property {boolean} isPrimary
 * @property {string} access
 * @property {string} uploadedBy
 * @property {string} fileName
 * @property {Timestamp} uploadTimestamp
 */

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

// --- Validation ---
export function validateImageFile(file) {
  const errors = [];
  if (!file) {
    errors.push('No file provided');
  } else {
    if (!ALLOWED_TYPES.includes(file.type)) {
      errors.push('Invalid file type');
    }
    if (file.size > MAX_SIZE) {
      errors.push('File is too large (max 5MB)');
    }
  }
  return { isValid: errors.length === 0, errors };
}

// --- Storage Path Helpers ---
/** Path of a recipe image: `recipes/{recipeId}/images/{fileName}` (no category — see storage-paths.js). */
export function getImageStoragePath(recipeId, fileName) {
  return `${recipeImagesFolder(recipeId)}/${fileName}`;
}

// --- Image ID Helper ---
// Unique image ID with 'img-' prefix (shared recipe model).
export { generateImageId } from '../../shared/recipe-model.js';

// --- Retrieval ---
/**
 * Returns only accessible images for a user role
 * @param {Object} recipe
 * @param {string} userRole
 * @returns {Array<RecipeImage>}
 */
export function getRecipeImages(recipe, userRole) {
  if (!recipe || !Array.isArray(recipe.images)) return [];
  const ACCESS_LEVELS = {
    manager: ['manager', 'approved', 'public'],
    approved: ['approved', 'public'],
    user: ['public'],
    public: ['public'],
  };
  const allowed = ACCESS_LEVELS[userRole] || ['public'];
  return recipe.images.filter((img) => allowed.includes(img.access));
}

/**
 * Gets placeholder image URL for recipes without images
 * @returns {null} Returns null to indicate no image is available
 */
export function getPlaceholderImageUrl() {
  return null;
}

/**
 * Returns the primary image object for a recipe
 * @param {Object} recipe - Recipe object with images array
 * @returns {RecipeImage|undefined} The primary image object or undefined
 */
export function getPrimaryImage(recipe) {
  if (!recipe || !Array.isArray(recipe.images) || recipe.images.length === 0) return undefined;
  const primary = recipe.images.find((img) => img.isPrimary);
  return primary || recipe.images[0];
}
