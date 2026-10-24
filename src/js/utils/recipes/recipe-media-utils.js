/*
 * Recipe Media Instructions Utilities
 * ------------------------------------
 * Pure helpers for media-instruction handling. No I/O.
 *
 * Exported:
 *
 * Validation:
 *   - validateMediaFile(file): Validate single media file (type and size).
 *   - validateMediaInstructionData(mediaInstructions): Validate metadata array shape.
 *
 * ID Generation:
 *   - generateMediaInstructionId(): UUID-like id for a media instruction.
 *
 * Storage operations (upload, delete, getUrl, removeAll) live on
 * MediaInstructionService.
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

// --- Constants ---
// Allowed types and the size cap come from the shared recipe model.
import {
  MEDIA_TYPES as ALLOWED_TYPES,
  MEDIA_MAX_BYTES as MAX_SIZE,
  generateMediaInstructionId,
} from '../../shared/recipe-model.js';

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
// UUID-like id for a media instruction (shared recipe model).
export { generateMediaInstructionId };
