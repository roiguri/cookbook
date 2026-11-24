import { uploadBlobWithOwner } from '../_firebase/storage-adapter';
import { captureError } from '../logger';

/**
 * Storage rules hard cap for built chef avatars (`user-avatars/{uid}.png`):
 * must be strictly under 200 KB (204,800 bytes) with `image/png` and `uploadedBy == uid`.
 */
export const MAX_AVATAR_PNG_BYTES = 200 * 1024;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export function getAvatarStoragePath(uid: string): string {
  return `user-avatars/${uid}.png`;
}

function isPngHeader(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PNG_MAGIC.length) return false;
  for (let i = 0; i < PNG_MAGIC.length; i += 1) {
    if (bytes[i] !== PNG_MAGIC[i]) return false;
  }
  return true;
}

export const AvatarUploadService = {
  getAvatarStoragePath,

  /**
   * Uploads a rasterized 256x256 chef avatar PNG to `user-avatars/{uid}.png`.
   * Enforces INV-P0-05 (`contentType: 'image/png'`, `< 200 KB`, mandatory `uploadedBy: uid`)
   * and returns a cache-busted download URL (`?v=` or `&v=`).
   */
  async uploadAvatarPng(uid: string, bytes: Uint8Array): Promise<string> {
    const trimmedUid = String(uid || '').trim();
    if (!trimmedUid) {
      throw new Error('AvatarUploadService.uploadAvatarPng: uid is required');
    }
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      throw new Error('AvatarUploadService.uploadAvatarPng: PNG bytes are empty');
    }
    if (!isPngHeader(bytes)) {
      throw new Error('AvatarUploadService.uploadAvatarPng: payload is not a valid PNG');
    }
    if (bytes.byteLength >= MAX_AVATAR_PNG_BYTES) {
      throw new Error(
        `AvatarUploadService.uploadAvatarPng: PNG exceeds 200 KB limit (${bytes.byteLength} bytes)`,
      );
    }

    const fullPath = getAvatarStoragePath(trimmedUid);
    try {
      const { downloadUrl } = await uploadBlobWithOwner(fullPath, bytes, {
        uploadedBy: trimmedUid,
        contentType: 'image/png',
      });
      const sep = downloadUrl.includes('?') ? '&' : '?';
      return `${downloadUrl}${sep}v=${Date.now()}`;
    } catch (err) {
      captureError(err, {
        service: 'avatar-upload',
        op: 'uploadAvatarPng',
        uid: trimmedUid,
        byteLength: bytes.byteLength,
      });
      throw err;
    }
  },
};
