/*
 * Recipe Image Utilities
 * ---------------------
 * This module provides helper functions for image upload, management, and retrieval for recipes.
 *
 * Exported Methods:
 *
 * Validation:
 *   - validateImageFile(file): Validate file type and size.
 *
 * Storage Path Helpers:
 *   - getImageStoragePath(recipeId, category, fileName, type): Get storage path for image.
 *   - generateImageId(): Generate a unique image ID.
 *
 * Multi Pending Images:
 *   - addPendingImages(recipeId, files, category, uploader): Upload multiple pending images.
 *   - approvePendingImageById(recipeId, pendingImageId): Approve a specific pending image by ID.
 *   - rejectPendingImageById(recipeId, pendingImageId): Reject/delete a specific pending image by ID.
 *   - getPendingImages(recipeId): Get all pending images for a recipe.
 *
 * Approved Images:
 *   - getRecipeImages(recipe, userRole): Get accessible images for a user role.
 *   - getPrimaryImage(recipe): Get the primary image object.
 *   - getPlaceholderImageUrl(): Get the placeholder image URL.
 */

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

/**
 * @typedef {Object} PendingRecipeImage
 * @property {string} id
 * @property {string} full
 * @property {string} fileExtension
 * @property {Timestamp} timestamp
 * @property {string} uploadedBy
 */

// --- Imports ---
import { StorageService } from '../../services/_firebase/storage-service.js';
import { FirestoreService } from '../../services/_firebase/firestore-service.js';

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
export function getImageStoragePath(recipeId, category, fileName, type = 'full') {
  const base = `img/recipes/${type}/${category}/${recipeId}`;
  return `${base}/${fileName}`;
}

// --- Firestore Helpers ---
async function getRecipeDoc(recipeId) {
  return await FirestoreService.getDocument('recipes', recipeId);
}
async function updateRecipeDoc(recipeId, data) {
  return await FirestoreService.updateDocument('recipes', recipeId, data);
}

// --- Image ID Helper ---
/**
 * Generates a unique image ID with 'img-' prefix
 * @returns {string}
 */
export function generateImageId() {
  return 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

// --- Image File Deletion ---
/**
 * Deletes all storage files for an image: full original and WebP variants.
 * The full-size deletion propagates errors; variant deletions are best-effort.
 *
 * Not exported: the public API for image-file deletion is
 * RecipeImageService.deleteFiles. This helper remains here only so the
 * pending-image proposal flow (rejectPendingImageById) can call it without
 * crossing layers. It moves into RecipeImageProposalService in Q2.
 *
 * @param {Object} image - Image object with `full` path
 * @returns {Promise<void>}
 */
async function deleteImageFiles({ full }) {
  const optimized400 = full.replace(/\.[^.]+$/, '_400x400.webp');
  const optimized1080 = full.replace(/\.[^.]+$/, '_1080x1080.webp');
  const originalBackup = full.replace(/(\.[^.]+)$/, '_original$1');
  // The Storage Resize extension also generates WebP variants for the
  // `_original` backup file itself, so those need explicit cleanup too.
  const originalOpt400 = originalBackup.replace(/\.[^.]+$/, '_400x400.webp');
  const originalOpt1080 = originalBackup.replace(/\.[^.]+$/, '_1080x1080.webp');
  await StorageService.deleteFile(full);
  await Promise.all([
    StorageService.deleteFile(optimized400).catch(() => {}),
    StorageService.deleteFile(optimized1080).catch(() => {}),
    StorageService.deleteFile(originalBackup).catch(() => {}),
    StorageService.deleteFile(originalOpt400).catch(() => {}),
    StorageService.deleteFile(originalOpt1080).catch(() => {}),
  ]);
}

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

/**
 * Uploads multiple pending images for a recipe (to be approved by manager)
 * @param {string} recipeId
 * @param {File[]} files
 * @param {string} category
 * @param {string} uploader
 * @returns {Promise<Array>} Array of pending image objects
 */
export async function addPendingImages(recipeId, files, category, uploader) {
  if (!Array.isArray(files) || files.length === 0) return [];
  const recipe = await getRecipeDoc(recipeId);
  const pendingImages = Array.isArray(recipe.pendingImages) ? [...recipe.pendingImages] : [];

  // Upload all images in parallel for better performance
  const uploadPromises = files.map(async (file) => {
    const fileExtension = file.name.split('.').pop();
    const id = generateImageId();
    const fileName = `${id}.${fileExtension}`;
    // Upload full-size
    const fullPath = getImageStoragePath(recipeId, category, fileName, 'full');
    await StorageService.uploadFile(file, fullPath);

    return {
      id,
      full: fullPath,
      fileExtension,
      timestamp: new Date(),
      uploadedBy: uploader,
    };
  });

  const newPendingImages = await Promise.all(uploadPromises);
  pendingImages.push(...newPendingImages);
  await updateRecipeDoc(recipeId, { pendingImages });
  return newPendingImages;
}

/**
 * Approves a specific pending image for a recipe, moving it to the images array
 * @param {string} recipeId
 * @param {string} pendingImageId
 * @returns {Promise<string>} The new image ID after approval
 */
export async function approvePendingImageById(recipeId, pendingImageId) {
  const recipe = await getRecipeDoc(recipeId);
  if (!recipe || !Array.isArray(recipe.pendingImages))
    throw new Error('No pending images to approve');
  const idx = recipe.pendingImages.findIndex((img) => img.id === pendingImageId);
  if (idx === -1) throw new Error('Pending image not found');
  const pendingImage = recipe.pendingImages[idx];
  const newImageId = generateImageId();
  const newImage = {
    id: newImageId,
    full: pendingImage.full,
    isPrimary: !recipe.images || recipe.images.length === 0,
    access: 'public',
    uploadedBy: pendingImage.uploadedBy,
    fileName: `${pendingImageId}.${pendingImage.fileExtension}`,
    uploadTimestamp: new Date(),
  };
  const images = Array.isArray(recipe.images) ? [...recipe.images, newImage] : [newImage];
  const pendingImages = recipe.pendingImages.filter((img) => img.id !== pendingImageId);
  await updateRecipeDoc(recipeId, { images, pendingImages });
  return newImageId;
}

/**
 * Rejects a specific pending image for a recipe, deleting it from storage and Firestore
 * @param {string} recipeId
 * @param {string} pendingImageId
 * @returns {Promise<void>}
 */
export async function rejectPendingImageById(recipeId, pendingImageId) {
  const recipe = await getRecipeDoc(recipeId);
  if (!recipe || !Array.isArray(recipe.pendingImages))
    throw new Error('No pending images to reject');
  const idx = recipe.pendingImages.findIndex((img) => img.id === pendingImageId);
  if (idx === -1) throw new Error('Pending image not found');
  const pendingImage = recipe.pendingImages[idx];
  await deleteImageFiles(pendingImage);
  const pendingImages = recipe.pendingImages.filter((img) => img.id !== pendingImageId);
  await updateRecipeDoc(recipeId, { pendingImages });
}

/**
 * Returns the array of pending images for a recipe
 * @param {string} recipeId
 * @returns {Promise<Array>}
 */
export async function getPendingImages(recipeId) {
  const recipe = await getRecipeDoc(recipeId);
  return Array.isArray(recipe?.pendingImages) ? recipe.pendingImages : [];
}
