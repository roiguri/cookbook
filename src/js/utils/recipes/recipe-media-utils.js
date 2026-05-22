/*
 * Recipe Media Instructions Utilities
 * ------------------------------------
 * This module provides helper functions for media instruction upload, management, and validation.
 *
 * Exported Methods:
 *
 * Upload & Delete:
 *   - uploadMediaInstructionFile(file, recipeId, userId): Upload media file to Firebase Storage
 *   - deleteMediaInstructionFile(filePath): Delete media file from Firebase Storage
 *
 * Validation:
 *   - validateMediaInstructionData(mediaInstructions): Validate array of media instructions
 *   - validateMediaFile(file): Validate single media file (type and size)
 *
 * ID Generation:
 *   - generateMediaInstructionId(): Generate unique ID for media instruction
 */

/**
 * @typedef {Object} MediaInstruction
 * @property {string} id - Unique identifier (UUID)
 * @property {string} path - Firebase Storage path
 * @property {string} caption - Hebrew instruction text
 * @property {'image'|'video'} type - Media type
 * @property {number} order - Display order (0-based)
 * @property {string} uploadedBy - User ID who uploaded
 * @property {Timestamp} uploadedAt - Upload timestamp
 */

// --- Imports ---
import { StorageService } from '../../services/_firebase/storage-service.js';

// --- Constants ---
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];
const MAX_SIZE = 50 * 1024 * 1024; // 50MB

// --- Validation ---
/**
 * Validates a single media file (type and size)
 * @param {File} file - The file to validate
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export function validateMediaFile(file) {
  const errors = [];

  if (!file) {
    errors.push('לא סופק קובץ');
    return { isValid: false, errors };
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    errors.push(
      `סוג קובץ לא תקין: ${file.type}. סוגי קבצים מותרים: תמונות (JPEG, PNG, WebP, GIF) וסרטונים (MP4, WebM, MOV)`,
    );
  }

  if (file.size > MAX_SIZE) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    errors.push(`הקובץ גדול מדי (${sizeMB}MB). גודל מקסימלי: 50MB`);
  }

  return { isValid: errors.length === 0, errors };
}

/**
 * Validates media instructions array structure and data
 *
 * NOTE: This validation function is currently NOT used in production code.
 * It exists for potential future use and documents the expected data structure.
 * TODO: Consider using this validation before saving to Firestore to catch data issues early.
 *
 * @param {Array<MediaInstruction>} mediaInstructions - Array of media instructions to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateMediaInstructionData(mediaInstructions) {
  const errors = [];

  if (!Array.isArray(mediaInstructions)) {
    errors.push('mediaInstructions must be an array');
    return { valid: false, errors };
  }

  mediaInstructions.forEach((item, index) => {
    const prefix = `Item ${index}:`;

    // Required fields
    if (!item.id || typeof item.id !== 'string') {
      errors.push(`${prefix} Missing or invalid 'id' field`);
    }
    if (!item.path || typeof item.path !== 'string') {
      errors.push(`${prefix} Missing or invalid 'path' field`);
    }
    if (typeof item.caption !== 'string') {
      errors.push(`${prefix} Missing or invalid 'caption' field`);
    }
    if (!item.type || !['image', 'video'].includes(item.type)) {
      errors.push(`${prefix} Invalid 'type' field (must be 'image' or 'video')`);
    }
    if (typeof item.order !== 'number' || item.order < 0) {
      errors.push(`${prefix} Invalid 'order' field (must be a non-negative number)`);
    }
    if (!item.uploadedBy || typeof item.uploadedBy !== 'string') {
      errors.push(`${prefix} Missing or invalid 'uploadedBy' field`);
    }
    if (!item.uploadedAt) {
      errors.push(`${prefix} Missing 'uploadedAt' field`);
    }
  });

  return { valid: errors.length === 0, errors };
}

// --- ID Generation ---
/**
 * Generates a unique media instruction ID with 'media-' prefix
 * Uses crypto.randomUUID() for guaranteed uniqueness and cryptographic security
 * @returns {string} Format: 'media-550e8400-e29b-41d4-a716-446655440000'
 */
export function generateMediaInstructionId() {
  // Use globalThis.crypto for compatibility with both browsers and Node.js
  return 'media-' + globalThis.crypto.randomUUID();
}

// --- Determine Media Type ---
/**
 * Determines if a file is an image or video based on MIME type
 * @param {File} file - The file to check
 * @returns {'image'|'video'|null}
 */
function getMediaType(file) {
  if (ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return 'image';
  }
  if (ALLOWED_VIDEO_TYPES.includes(file.type)) {
    return 'video';
  }
  return null;
}

// --- Upload & Delete ---
/**
 * Uploads a media instruction file to Firebase Storage
 * @param {File} file - The file to upload
 * @param {string} recipeId - The recipe ID
 * @param {string} userId - The user ID who is uploading
 * @param {Function} [onProgress] - Optional progress callback (percent: number) => void
 * @returns {Promise<MediaInstruction>} Metadata object for the uploaded file
 * @throws {Error} If validation fails or upload fails
 */
export async function uploadMediaInstructionFile(file, recipeId, userId, onProgress) {
  // Validate file
  const validation = validateMediaFile(file);
  if (!validation.isValid) {
    throw new Error(`בדיקת הקובץ נכשלה: ${validation.errors.join(', ')}`);
  }

  // Validate required parameters
  if (!recipeId || typeof recipeId !== 'string') {
    throw new Error('Invalid recipeId');
  }
  if (!userId || typeof userId !== 'string') {
    throw new Error('Invalid userId');
  }

  try {
    // Generate a single ID for both storage path and metadata
    const mediaId = generateMediaInstructionId();
    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `recipes/${recipeId}/media-instructions/${mediaId}_${sanitizedFileName}`;

    // Determine media type
    const mediaType = getMediaType(file);
    if (!mediaType) {
      throw new Error('Unable to determine media type');
    }

    // TODO: Implement progress tracking with Firebase Storage 'state_changed' listener
    // For now, onProgress is accepted but not used (can be implemented later)
    if (onProgress && typeof onProgress === 'function') {
      onProgress(0);
    }

    // Upload to Firebase Storage
    await StorageService.uploadFile(file, storagePath);

    if (onProgress && typeof onProgress === 'function') {
      onProgress(100);
    }

    // Build and return metadata
    const metadata = {
      id: mediaId, // Same ID as used in storage path
      path: storagePath,
      caption: '', // Empty caption - to be filled by user
      type: mediaType,
      order: 0, // Default order - to be updated when added to array
      uploadedBy: userId,
      uploadedAt: new Date(),
    };

    return metadata;
  } catch (error) {
    console.error('Error uploading media instruction file:', error);
    throw new Error(`העלאת הקובץ נכשלה: ${error.message}`);
  }
}

/**
 * Deletes a media instruction file from Firebase Storage
 * @param {string} filePath - The storage path of the file to delete
 * @returns {Promise<void>}
 * @throws {Error} If deletion fails
 */
export async function deleteMediaInstructionFile(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid filePath');
  }

  try {
    await StorageService.deleteFile(filePath);
  } catch (error) {
    // Handle "file not found" gracefully
    if (error.code === 'storage/object-not-found') {
      console.warn(`Media instruction file not found (may already be deleted): ${filePath}`);
      return; // Don't throw error for already-deleted files
    }

    console.error('Error deleting media instruction file:', error);
    throw new Error(`מחיקת הקובץ נכשלה: ${error.message}`);
  }
}

/**
 * Deletes multiple media instruction files from Firebase Storage
 * @param {string[]} filePaths - Array of storage paths to delete
 * @returns {Promise<{ success: number, failed: number, errors: Array }>}
 */
export async function deleteMediaInstructionFiles(filePaths) {
  if (!Array.isArray(filePaths)) {
    throw new Error('filePaths must be an array');
  }

  const results = {
    success: 0,
    failed: 0,
    errors: [],
  };

  const deletePromises = filePaths.map(async (path) => {
    try {
      await deleteMediaInstructionFile(path);
      results.success++;
    } catch (error) {
      results.failed++;
      results.errors.push({ path, error: error.message });
    }
  });

  await Promise.all(deletePromises);

  return results;
}

/**
 * Gets the download URL for a media instruction file
 * @param {string} storagePath - The storage path
 * @returns {Promise<string>} The download URL
 */
export async function getMediaInstructionUrl(storagePath) {
  if (!storagePath) return '';

  // If it's already a URL (blob or data), return it directly
  if (storagePath.startsWith('blob:') || storagePath.startsWith('data:')) {
    return storagePath;
  }

  try {
    return await StorageService.getFileUrl(storagePath);
  } catch (error) {
    console.error('Error getting media instruction URL:', error);
    throw new Error(`קבלת כתובת המדיה נכשלה: ${error.message}`);
  }
}

/**
 * Removes all media instruction files for a recipe
 * @param {Array<MediaInstruction>} mediaInstructions - Array of media instructions to delete
 * @returns {Promise<{ success: number, failed: number, errors: Array }>}
 */
export async function removeAllMediaInstructions(mediaInstructions) {
  if (!Array.isArray(mediaInstructions) || mediaInstructions.length === 0) {
    return { success: 0, failed: 0, errors: [] };
  }

  const filePaths = mediaInstructions.map((media) => media.path);
  return await deleteMediaInstructionFiles(filePaths);
}
