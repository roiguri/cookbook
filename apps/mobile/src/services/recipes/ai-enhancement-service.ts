import { callCloudFunction } from '../_firebase/functions-adapter';
import {
  deleteStorageFile,
  getStorageDownloadUrl,
  getStorageMetadata,
  uploadBlobWithOwner,
} from '../_firebase/storage-adapter';
import { captureError } from '../logger';
import { RecipeImageService } from './recipe-image-service';
import { RecipeService, type RecipeImageEntry } from './recipe-service';

export const MAX_ENHANCEMENT_INPUT_DIM = 1536;
export const ENHANCEMENT_JPEG_QUALITY = 0.92;
export const MAX_ENHANCEMENT_INSTRUCTION_LENGTH = 500;

export type EnhancementAxis = 'lighting' | 'angle' | 'surface' | 'styling';

export interface EnhancementAxisConfig {
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}

/**
 * Exact 1:1 parameter taxonomy matching `functions/utils/gemini/enhancement/food-image.js`
 * with Hebrew display labels matching Web `ai-image-enhance-modal.js`.
 */
export const ENHANCEMENT_PARAMETERS: Record<EnhancementAxis, EnhancementAxisConfig> = {
  lighting: {
    label: 'תאורה',
    options: [
      { value: 'natural', label: 'טבעית' },
      { value: 'commercial', label: 'סטודיו' },
      { value: 'moody', label: 'דרמטית' },
      { value: 'golden-hour', label: 'אור זהוב' },
      { value: 'backlit', label: 'אור מאחור' },
    ],
  },
  angle: {
    label: 'זווית צילום',
    options: [
      { value: 'flat-lay', label: 'מבט עליון' },
      { value: 'hero', label: 'זווית 45°' },
      { value: 'portrait', label: 'זווית נמוכה' },
      { value: 'macro', label: 'תקריב' },
      { value: 'side-profile', label: 'מבט מהצד' },
    ],
  },
  surface: {
    label: 'משטח',
    options: [
      { value: 'marble', label: 'שיש' },
      { value: 'wood', label: 'עץ כפרי' },
      { value: 'concrete', label: 'בטון' },
      { value: 'linen', label: 'בד פשתן' },
      { value: 'slate', label: 'אבן כהה' },
    ],
  },
  styling: {
    label: 'סגנון עיצוב',
    options: [
      { value: 'clean', label: 'נקי' },
      { value: 'editorial', label: 'עריכותי' },
      { value: 'ingredient-led', label: 'מבוסס מרכיבים' },
      { value: 'rustic-spread', label: 'מטבח כפרי' },
      { value: 'gourmet-plated', label: 'גורמה' },
    ],
  },
};

export const ENHANCEMENT_AXES: readonly EnhancementAxis[] = [
  'lighting',
  'angle',
  'surface',
  'styling',
];

export type EnhancementParameters = Partial<Record<EnhancementAxis, string | null>>;

export interface EnhanceFoodImageInput {
  image: {
    base64: string;
    mimeType?: string;
  };
  parameters?: EnhancementParameters;
  instruction?: string;
}

export interface EnhanceFoodImageResult {
  base64: string;
  mimeType: string;
  selectedParameters: Partial<Record<EnhancementAxis, string | null>>;
}

export interface ReplaceRecipeImageWithBackupParams {
  recipeId: string;
  imageId: string;
  base64: string;
  mimeType?: string;
  managerUid: string;
  keepOriginalBackup?: boolean;
}

export interface ReplaceRecipeImageWithBackupResult {
  backupPath: string;
  backupCreated: boolean;
  downloadUrl: string;
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = (() => {
  const table = new Uint8Array(256);
  table.fill(255);
  for (let i = 0; i < BASE64_CHARS.length; i += 1) {
    table[BASE64_CHARS.charCodeAt(i)] = i;
  }
  return table;
})();

function decodeBase64ToUint8Array(input: string): Uint8Array {
  const cleaned = input.replace(/^data:[^;]+;base64,/, '').replace(/[^A-Za-z0-9+/=]/g, '');
  let pad = 0;
  if (cleaned.endsWith('==')) pad = 2;
  else if (cleaned.endsWith('=')) pad = 1;
  const byteLength = Math.max(0, Math.floor((cleaned.length * 3) / 4) - pad);
  const out = new Uint8Array(byteLength);
  let outIdx = 0;

  for (let i = 0; i < cleaned.length; i += 4) {
    const a = BASE64_LOOKUP[cleaned.charCodeAt(i)] ?? 0;
    const b = BASE64_LOOKUP[cleaned.charCodeAt(i + 1)] ?? 0;
    const c = BASE64_LOOKUP[cleaned.charCodeAt(i + 2)] ?? 0;
    const d = BASE64_LOOKUP[cleaned.charCodeAt(i + 3)] ?? 0;
    const triplet = (a << 18) | (b << 12) | ((c & 63) << 6) | (d & 63);
    if (outIdx < byteLength) out[outIdx++] = (triplet >> 16) & 0xff;
    if (outIdx < byteLength) out[outIdx++] = (triplet >> 8) & 0xff;
    if (outIdx < byteLength) out[outIdx++] = triplet & 0xff;
  }
  return out;
}

function makeBackupPath(fullPath: string): string {
  if (/\.[^./]+$/.test(fullPath)) {
    return fullPath.replace(/(\.[^./]+)$/, '_original$1');
  }
  return `${fullPath}_original`;
}

function makeVariantPath(fullPath: string, suffix: string): string | null {
  if (!/\.[^./]+$/.test(fullPath)) return null;
  return fullPath.replace(/\.[^./]+$/, `_${suffix}.webp`);
}

function inferContentTypeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

async function storageFileExists(path: string): Promise<boolean> {
  try {
    await getStorageMetadata(path);
    return true;
  } catch {
    return false;
  }
}

async function fetchUrlAsBytes(url: string): Promise<Uint8Array | Blob> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch original image (${response.status})`);
  }
  if (typeof response.arrayBuffer === 'function') {
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }
  return response.blob();
}

/**
 * Calls the manager-only `enhanceFoodImage` Cloud Function callable.
 * Strips empty axis overrides so unset axes remain auto-selected by Gemini.
 */
export async function enhanceFoodImage({
  image,
  parameters,
  instruction,
}: EnhanceFoodImageInput): Promise<EnhanceFoodImageResult> {
  const rawBase64 =
    typeof image?.base64 === 'string' ? image.base64.replace(/^data:[^;]+;base64,/, '').trim() : '';
  if (!rawBase64) {
    throw new Error('image payload is required');
  }

  const cleanParams: Record<string, string> = {};
  if (parameters) {
    for (const axis of ENHANCEMENT_AXES) {
      const value = parameters[axis];
      if (typeof value === 'string' && value.trim()) {
        cleanParams[axis] = value.trim();
      }
    }
  }

  const trimmedInstruction =
    typeof instruction === 'string'
      ? instruction.trim().slice(0, MAX_ENHANCEMENT_INSTRUCTION_LENGTH)
      : '';

  const payload: Record<string, any> = {
    image: {
      base64: rawBase64,
      mimeType: image.mimeType || 'image/jpeg',
    },
  };
  if (Object.keys(cleanParams).length > 0) {
    payload.parameters = cleanParams;
  }
  if (trimmedInstruction) {
    payload.instruction = trimmedInstruction;
  }

  try {
    const data = await callCloudFunction<Record<string, any>, Partial<EnhanceFoodImageResult>>(
      'enhanceFoodImage',
      payload,
      { timeoutMs: 180_000 },
    );

    if (!data || typeof data.base64 !== 'string' || !data.base64) {
      throw new Error('Empty response from enhancement service');
    }

    return {
      base64: data.base64,
      mimeType: data.mimeType || 'image/png',
      selectedParameters: data.selectedParameters || {},
    };
  } catch (err) {
    captureError(err, { service: 'ai-enhancement', op: 'enhanceFoodImage' });
    throw err;
  }
}

/**
 * Resolves the full original Storage download URL for a recipe image entry
 * so UI components stay inside the two-tier service boundary (INV-P0-04).
 */
export async function getOriginalImageDownloadUrl(
  image: RecipeImageEntry | null | undefined,
): Promise<string> {
  if (!image) {
    throw new Error('getOriginalImageDownloadUrl: image is required');
  }
  if (typeof image.full === 'string' && image.full.trim()) {
    const raw = image.full.trim();
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      return raw;
    }
    return getStorageDownloadUrl(raw);
  }
  const resolved = await RecipeImageService.getOptimizedUrl(image, 'original');
  if (!resolved) {
    throw new Error('לא ניתן למצוא את כתובת התמונה המקורית');
  }
  return resolved;
}

/**
 * Replaces an existing recipe image with AI-enhanced bytes:
 * 1. Idempotently preserves the original at `<path>_original.<ext>` (only if backup doesn't exist yet),
 *    tagged with mandatory `uploadedBy: managerUid` (INV-P0-05).
 * 2. Deletes stale `_400x400.webp` and `_1080x1080.webp` variants BEFORE uploading the replacement
 *    so the Storage Resize extension is never raced.
 * 3. Uploads the enhanced image to the original Storage path with `uploadedBy: managerUid`.
 * 4. Clears RecipeImageService URL cache and updates `recipes/{recipeId}.images[]` setting `aiEnhanced: true`.
 */
export async function replaceRecipeImageWithBackup({
  recipeId,
  imageId,
  base64,
  mimeType = 'image/png',
  managerUid,
  keepOriginalBackup = true,
}: ReplaceRecipeImageWithBackupParams): Promise<ReplaceRecipeImageWithBackupResult> {
  if (!recipeId) {
    throw new Error('replaceRecipeImageWithBackup: recipeId is required');
  }
  if (!imageId) {
    throw new Error('replaceRecipeImageWithBackup: imageId is required');
  }
  if (!base64 || !base64.trim()) {
    throw new Error('replaceRecipeImageWithBackup: base64 is required');
  }
  if (!managerUid || !managerUid.trim()) {
    throw new Error('replaceRecipeImageWithBackup: managerUid is required (INV-P0-05)');
  }

  const recipe = await RecipeService.getById(recipeId);
  if (!recipe) {
    throw new Error(`replaceRecipeImageWithBackup: recipe ${recipeId} not found`);
  }

  const images = Array.isArray(recipe.images) ? recipe.images : [];
  const targetImage = images.find((img) => img?.id === imageId);
  if (!targetImage || !targetImage.full) {
    throw new Error(
      `replaceRecipeImageWithBackup: image ${imageId} not found on recipe ${recipeId}`,
    );
  }

  const originalPath = targetImage.full;
  const backupPath = makeBackupPath(originalPath);
  let backupCreated = false;

  try {
    // 1. Idempotent original backup
    if (keepOriginalBackup && !(await storageFileExists(backupPath))) {
      let originalContentType = inferContentTypeFromPath(originalPath);
      try {
        const meta = await getStorageMetadata(originalPath);
        if (meta?.contentType) {
          originalContentType = meta.contentType;
        }
      } catch {
        // Fallback to extension-inferred MIME type
      }

      const originalUrl = await getStorageDownloadUrl(originalPath);
      const originalBytes = await fetchUrlAsBytes(originalUrl);
      await uploadBlobWithOwner(backupPath, originalBytes, {
        uploadedBy: managerUid,
        contentType: originalContentType,
      });
      backupCreated = true;
    }

    // 2. Delete stale WebP variants BEFORE uploading replacement (exact Web parity)
    const opt400 = makeVariantPath(originalPath, '400x400');
    const opt1080 = makeVariantPath(originalPath, '1080x1080');
    await Promise.all([
      opt400 ? deleteStorageFile(opt400).catch(() => {}) : Promise.resolve(),
      opt1080 ? deleteStorageFile(opt1080).catch(() => {}) : Promise.resolve(),
    ]);

    // 3. Upload enhanced image bytes with mandatory uploadedBy metadata
    const enhancedBytes = decodeBase64ToUint8Array(base64);
    const { downloadUrl } = await uploadBlobWithOwner(originalPath, enhancedBytes, {
      uploadedBy: managerUid,
      contentType: mimeType || 'image/png',
    });

    // Clear cached image URLs so callers fetch the freshly replaced bytes
    RecipeImageService.clearCache();

    // 4. Patch recipes/{recipeId}.images[] with aiEnhanced: true (best-effort after Storage write)
    try {
      const fresh = await RecipeService.getById(recipeId);
      if (fresh && Array.isArray(fresh.images)) {
        const updatedImages = fresh.images.map((img) =>
          img?.id === imageId
            ? {
                ...img,
                aiEnhanced: true,
                url: downloadUrl,
              }
            : img,
        );
        await RecipeService.update(recipeId, { images: updatedImages });
      }
    } catch (patchErr) {
      captureError(patchErr, {
        service: 'ai-enhancement',
        op: 'replaceRecipeImageWithBackup:patchDoc',
        recipeId,
        imageId,
      });
    }

    return { backupPath, backupCreated, downloadUrl };
  } catch (err) {
    captureError(err, {
      service: 'ai-enhancement',
      op: 'replaceRecipeImageWithBackup',
      recipeId,
      imageId,
    });
    throw err;
  }
}

export function formatEnhancementError(error: unknown): string {
  const errObj = error as { code?: string; message?: string } | null;
  const code = String(errObj?.code || '');
  if (code.includes('unauthenticated')) {
    return 'יש להתחבר כדי להשתמש בתכונה זו.';
  }
  if (code.includes('permission-denied')) {
    return 'אין הרשאה — תכונה זו זמינה למנהלים בלבד.';
  }
  if (code.includes('resource-exhausted')) {
    return 'הגענו למכסת השימוש הזמנית. אנא נסו שוב בעוד רגע.';
  }
  return errObj?.message ? `שגיאה: ${errObj.message}` : 'שגיאה בשיפור התמונה';
}

export const AiEnhancementService = {
  enhanceFoodImage,
  replaceRecipeImageWithBackup,
  getOriginalImageDownloadUrl,
  formatEnhancementError,
};
