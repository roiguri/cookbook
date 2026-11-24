import { LRUCache } from '@cookbook/core/lru-cache';
import {
  buildImageEntry,
  generateImageId,
  imageFileName,
  recipeImagesFolder,
} from '@cookbook/core/recipe-model';
import { getPrimaryImage } from '@cookbook/core/recipe-utils/recipe-image-utils';
import {
  deleteStorageFile,
  getStorageDownloadUrl,
  uploadBlobWithOwner,
} from '../_firebase/storage-adapter';
import { captureError } from '../logger';

export type RecipeImageSize = 'thumb' | 'full' | 'original' | '400x400' | '1080x1080';

export interface UploadedRecipeImageEntry {
  id: string;
  full: string;
  fileName: string;
  isPrimary: boolean;
  uploadedBy: string;
  access: string;
  uploadTimestamp: Date;
  url: string;
}

const urlCache = new LRUCache<string, string>(250);

function isDirectUrl(value: string): boolean {
  return (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('file://') ||
    value.startsWith('content://') ||
    value.startsWith('data:')
  );
}

function resolveSizeSuffix(size: RecipeImageSize): '400x400' | '1080x1080' | null {
  if (size === 'original') return null;
  if (size === 'full' || size === '1080x1080') return '1080x1080';
  return '400x400';
}

function makeVariantPath(fullPath: string, suffix: string): string | null {
  if (!/\.[^./]+$/.test(fullPath)) return null;
  return fullPath.replace(/\.[^./]+$/, `_${suffix}.webp`);
}

function makeBackupPath(fullPath: string): string | null {
  if (!/\.[^./]+$/.test(fullPath)) return null;
  return fullPath.replace(/(\.[^./]+)$/, '_original$1');
}

function evictPathFromCache(fullPath: string): void {
  const sizes: RecipeImageSize[] = ['thumb', 'full', 'original', '400x400', '1080x1080'];
  for (const s of sizes) {
    urlCache.delete(`${fullPath}::${s}`);
  }
}

export const RecipeImageService = {
  /**
   * Resolve download URL for an image entry or Storage path.
   * Tries `_400x400.webp` (thumb) or `_1080x1080.webp` (full) first,
   * then gracefully falls back to the original Storage object, then `img.url`.
   */
  async getOptimizedUrl(imgOrPath: any, size: RecipeImageSize = 'thumb'): Promise<string | null> {
    if (!imgOrPath) return null;

    let fullPath: string | null = null;
    let fallbackUrl: string | null = null;

    if (typeof imgOrPath === 'string') {
      const trimmed = imgOrPath.trim();
      if (!trimmed) return null;
      if (isDirectUrl(trimmed)) return trimmed;
      fullPath = trimmed;
    } else if (typeof imgOrPath === 'object') {
      if (typeof imgOrPath.preview === 'string' && imgOrPath.preview.trim()) {
        return imgOrPath.preview.trim();
      }
      const rawPath =
        typeof imgOrPath.full === 'string' && imgOrPath.full.trim()
          ? imgOrPath.full.trim()
          : typeof imgOrPath.path === 'string' && imgOrPath.path.trim()
            ? imgOrPath.path.trim()
            : null;

      fallbackUrl =
        typeof imgOrPath.url === 'string' && imgOrPath.url.trim() ? imgOrPath.url.trim() : null;

      if (rawPath) {
        if (isDirectUrl(rawPath)) return rawPath;
        fullPath = rawPath;
      } else {
        return fallbackUrl;
      }
    }

    if (!fullPath) return fallbackUrl;

    const cacheKey = `${fullPath}::${size}`;
    const cached = urlCache.get(cacheKey);
    if (cached) return cached;

    const suffix = resolveSizeSuffix(size);
    if (suffix) {
      const variantPath = makeVariantPath(fullPath, suffix);
      if (variantPath) {
        try {
          const variantUrl = await getStorageDownloadUrl(variantPath);
          urlCache.set(cacheKey, variantUrl);
          return variantUrl;
        } catch {
          // Variant may not exist yet (e.g. local DTU or pre-resize upload); fall back to original
        }
      }
    }

    try {
      const originalUrl = await getStorageDownloadUrl(fullPath);
      urlCache.set(cacheKey, originalUrl);
      return originalUrl;
    } catch {
      if (fallbackUrl) {
        urlCache.set(cacheKey, fallbackUrl);
        return fallbackUrl;
      }
      return null;
    }
  },

  /**
   * Resolve download URL for a recipe's primary (or first) image.
   */
  async getPrimaryImageUrl(
    recipe: any,
    size: 'thumb' | 'full' | 'original' = 'thumb',
  ): Promise<string | null> {
    const primary = getPrimaryImage(recipe);
    if (!primary) return null;
    return RecipeImageService.getOptimizedUrl(primary, size);
  },

  /**
   * Alias matching Web `RecipeImageService.getPrimaryUrl`.
   */
  async getPrimaryUrl(recipe: any, size: RecipeImageSize = 'thumb'): Promise<string | null> {
    const primary = getPrimaryImage(recipe);
    if (!primary) return null;
    return RecipeImageService.getOptimizedUrl(primary, size);
  },

  /**
   * Upload a recipe image to `recipes/{recipeId}/images/{imgId}.{ext}` (or custom folder)
   * with mandatory `customMetadata.uploadedBy = uid` (INV-P0-05).
   */
  async uploadRecipeImage(
    recipeId: string,
    uid: string,
    blob: Blob | Uint8Array,
    opts?: {
      ext?: string;
      contentType?: string;
      isPrimary?: boolean;
      folder?: string;
    },
  ): Promise<UploadedRecipeImageEntry> {
    if (!recipeId) throw new Error('RecipeImageService.uploadRecipeImage: recipeId is required');
    if (!uid) throw new Error('RecipeImageService.uploadRecipeImage: uid is required');

    const rawExt = (opts?.ext || 'jpg').replace(/^\./, '').toLowerCase() || 'jpg';
    const contentType =
      opts?.contentType ||
      (rawExt === 'png' ? 'image/png' : rawExt === 'webp' ? 'image/webp' : 'image/jpeg');

    const id = generateImageId();
    const fileName = imageFileName(id, `photo.${rawExt}`);
    const folder = opts?.folder || recipeImagesFolder(recipeId);
    const fullPath = `${folder}/${fileName}`;

    const { downloadUrl } = await uploadBlobWithOwner(fullPath, blob, {
      uploadedBy: uid,
      contentType,
    });

    const entry = buildImageEntry({
      id,
      path: fullPath,
      fileName,
      isPrimary: Boolean(opts?.isPrimary),
      uploadedBy: uid,
    });

    urlCache.set(`${fullPath}::original`, downloadUrl);
    return {
      ...entry,
      url: downloadUrl,
    };
  },

  /**
   * Best-effort deletion of a recipe's images and their resized WebP & backup variants.
   */
  async deleteRecipeImages(recipeId: string, images?: any[]): Promise<void> {
    if (!Array.isArray(images) || images.length === 0) return;

    const tasks: Array<Promise<void>> = [];

    for (const img of images) {
      const fullPath =
        typeof img === 'string'
          ? img
          : typeof img?.full === 'string'
            ? img.full
            : typeof img?.path === 'string'
              ? img.path
              : null;

      if (!fullPath || isDirectUrl(fullPath)) continue;

      evictPathFromCache(fullPath);

      const candidates = new Set<string>([fullPath]);
      const opt400 = makeVariantPath(fullPath, '400x400');
      const opt1080 = makeVariantPath(fullPath, '1080x1080');
      const backup = makeBackupPath(fullPath);
      if (opt400) candidates.add(opt400);
      if (opt1080) candidates.add(opt1080);
      if (backup) {
        candidates.add(backup);
        const backup400 = makeVariantPath(backup, '400x400');
        const backup1080 = makeVariantPath(backup, '1080x1080');
        if (backup400) candidates.add(backup400);
        if (backup1080) candidates.add(backup1080);
      }

      for (const path of candidates) {
        tasks.push(
          deleteStorageFile(path).catch((err) => {
            if (path === fullPath) {
              captureError(err, {
                service: 'recipe-image',
                op: 'deleteRecipeImages',
                recipeId,
              });
            }
          }),
        );
      }
    }

    await Promise.all(tasks);
  },

  clearCache(): void {
    urlCache.clear();
  },
};
