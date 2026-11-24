import * as Crypto from 'expo-crypto';
import { LRUCache } from '@cookbook/core/lru-cache';
import {
  buildMediaEntry,
  generateMediaInstructionId,
  MEDIA_MAX_BYTES,
  mediaFileName,
  mediaTypeOf,
  recipeMediaFolder,
} from '@cookbook/core/recipe-model';
import {
  deleteStorageFile,
  getStorageDownloadUrl,
  uploadBlobWithOwner,
} from '../_firebase/storage-adapter';
import { captureError } from '../logger';

export interface MediaInstructionItem {
  id?: string;
  path?: string;
  url?: string;
  preview?: string;
  caption?: string;
  type?: 'image' | 'video' | string;
  order?: number;
  uploadedBy?: string;
  uploadedAt?: any;
}

export interface UploadedMediaInstructionEntry {
  id: string;
  path: string;
  caption: string;
  type: 'image' | 'video';
  order: number;
  uploadedBy: string;
  uploadedAt: Date;
  url: string;
}

export interface UploadMediaInstructionOptions {
  fileName?: string;
  contentType?: string;
  type?: 'image' | 'video';
  caption?: string;
  order?: number;
  folder?: string;
}

const mediaUrlCache = new LRUCache<string, string>(200);

function isDirectUrl(value: string): boolean {
  return (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('file://') ||
    value.startsWith('content://') ||
    value.startsWith('data:') ||
    value.startsWith('blob:')
  );
}

function createSafeMediaId(): string {
  try {
    return generateMediaInstructionId();
  } catch {
    return `media-${Crypto.randomUUID()}`;
  }
}

function inferContentType(fileName?: string, explicitType?: 'image' | 'video'): string {
  const lower = (fileName || '').toLowerCase();
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return explicitType === 'video' ? 'video/mp4' : 'image/jpeg';
}

function getBlobSize(blob: Blob | Uint8Array): number {
  if (blob instanceof Uint8Array) return blob.byteLength;
  if (typeof (blob as Blob)?.size === 'number') return (blob as Blob).size;
  return 0;
}

/**
 * Resolve a playable/displayable download URL for a media instruction item or Storage path.
 * Passes direct URLs through unchanged and caches Storage download URLs in an LRU cache.
 */
export async function resolveMediaUrl(
  item: MediaInstructionItem | string | null | undefined,
): Promise<string | null> {
  if (!item) return null;

  let storagePath: string | null = null;
  let fallbackUrl: string | null = null;

  if (typeof item === 'string') {
    const trimmed = item.trim();
    if (!trimmed) return null;
    if (isDirectUrl(trimmed)) return trimmed;
    storagePath = trimmed;
  } else if (typeof item === 'object') {
    if (typeof item.preview === 'string' && item.preview.trim()) {
      return item.preview.trim();
    }
    const rawPath = typeof item.path === 'string' && item.path.trim() ? item.path.trim() : null;
    fallbackUrl = typeof item.url === 'string' && item.url.trim() ? item.url.trim() : null;

    if (rawPath) {
      if (isDirectUrl(rawPath)) return rawPath;
      storagePath = rawPath;
    } else {
      return fallbackUrl;
    }
  }

  if (!storagePath) return fallbackUrl;

  const cached = mediaUrlCache.get(storagePath);
  if (cached) return cached;

  try {
    const url = await getStorageDownloadUrl(storagePath);
    mediaUrlCache.set(storagePath, url);
    return url;
  } catch (err) {
    if (fallbackUrl) {
      mediaUrlCache.set(storagePath, fallbackUrl);
      return fallbackUrl;
    }
    captureError(err, { service: 'media-instruction', op: 'resolveMediaUrl' });
    return null;
  }
}

/**
 * Upload a step media instruction (image or video) to
 * `recipes/${recipeId}/media/${mediaId}_${sanitizedName}` (or custom folder)
 * with mandatory `customMetadata.uploadedBy = uid` (INV-P0-05).
 */
export async function uploadMediaInstruction(
  recipeId: string,
  uid: string,
  blob: Blob | Uint8Array,
  opts: UploadMediaInstructionOptions = {},
): Promise<UploadedMediaInstructionEntry> {
  if (!recipeId || typeof recipeId !== 'string') {
    throw new Error('MediaInstructionService.uploadMediaInstruction: recipeId is required');
  }
  if (!uid || typeof uid !== 'string') {
    throw new Error('MediaInstructionService.uploadMediaInstruction: uid is required');
  }
  if (!blob) {
    throw new Error('MediaInstructionService.uploadMediaInstruction: blob is required');
  }

  const size = getBlobSize(blob);
  if (size > MEDIA_MAX_BYTES) {
    const sizeMB = (size / (1024 * 1024)).toFixed(2);
    throw new Error(`הקובץ גדול מדי (${sizeMB}MB). גודל מקסימלי: 50MB`);
  }

  const contentType =
    opts.contentType ||
    (typeof (blob as Blob)?.type === 'string' && (blob as Blob).type.trim()
      ? (blob as Blob).type.trim()
      : inferContentType(opts.fileName, opts.type));

  const mediaType = opts.type || mediaTypeOf(contentType);
  if (!mediaType) {
    throw new Error(
      `סוג קובץ לא תקין: ${contentType}. סוגי קבצים מותרים: תמונות (JPEG, PNG, WebP, GIF) וסרטונים (MP4, WebM, MOV)`,
    );
  }

  const defaultExt = mediaType === 'video' ? 'mp4' : 'jpg';
  const originalName = (opts.fileName || `step.${defaultExt}`).trim() || `step.${defaultExt}`;
  const mediaId = createSafeMediaId();
  const folder = opts.folder || recipeMediaFolder(recipeId);
  const fullPath = `${folder}/${mediaFileName(mediaId, originalName)}`;

  try {
    const { downloadUrl } = await uploadBlobWithOwner(fullPath, blob, {
      uploadedBy: uid,
      contentType,
    });

    mediaUrlCache.set(fullPath, downloadUrl);

    const baseEntry = buildMediaEntry({
      id: mediaId,
      path: fullPath,
      type: mediaType,
      uploadedBy: uid,
    });

    return {
      ...baseEntry,
      caption: typeof opts.caption === 'string' ? opts.caption.trim() : '',
      order: typeof opts.order === 'number' && opts.order >= 0 ? opts.order : 0,
      url: downloadUrl,
    };
  } catch (err) {
    captureError(err, { service: 'media-instruction', op: 'uploadMediaInstruction', recipeId });
    throw err;
  }
}

/**
 * Delete a single media instruction file from Firebase Storage.
 * Ignores direct URLs and treats missing files as already deleted.
 */
export async function deleteMediaInstruction(path: string): Promise<void> {
  if (!path || typeof path !== 'string') return;
  const trimmed = path.trim();
  if (!trimmed || isDirectUrl(trimmed)) return;

  mediaUrlCache.delete(trimmed);

  try {
    await deleteStorageFile(trimmed);
  } catch (err) {
    captureError(err, { service: 'media-instruction', op: 'deleteMediaInstruction' });
    throw err;
  }
}

export const MediaInstructionService = {
  resolveMediaUrl,
  getUrl: resolveMediaUrl,
  uploadMediaInstruction,
  deleteMediaInstruction,
  async deleteMany(paths: string[]): Promise<void> {
    if (!Array.isArray(paths) || paths.length === 0) return;
    await Promise.all(paths.map((p) => deleteMediaInstruction(p).catch(() => {})));
  },
  async removeAll(items?: MediaInstructionItem[]): Promise<void> {
    if (!Array.isArray(items) || items.length === 0) return;
    const paths = items
      .map((item) => item?.path)
      .filter((p): p is string => typeof p === 'string' && p.length > 0);
    await MediaInstructionService.deleteMany(paths);
  },
  clearCache(): void {
    mediaUrlCache.clear();
  },
};
