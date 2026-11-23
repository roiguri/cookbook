import {
  deleteObject,
  getDownloadURL,
  getMetadata,
  listAll,
  ref,
  uploadBytes,
  type UploadMetadata,
} from 'firebase/storage';
import { ensureFirebaseReady, getFirebaseStorage } from './firebase-app';

export function storageRef(fullPath: string) {
  ensureFirebaseReady();
  return ref(getFirebaseStorage(), fullPath);
}

/**
 * INV-P0-05: Every client Storage upload MUST carry `customMetadata.uploadedBy`.
 */
export async function uploadBlobWithOwner(
  fullPath: string,
  data: Blob | Uint8Array,
  {
    uploadedBy,
    contentType,
    extraMetadata = {},
  }: { uploadedBy: string; contentType: string; extraMetadata?: Record<string, string> },
): Promise<{ fullPath: string; downloadUrl: string }> {
  if (!uploadedBy || !uploadedBy.trim()) {
    throw new Error('Storage upload rejected: uploadedBy UID metadata is required (INV-P0-05).');
  }
  const metadata: UploadMetadata = {
    contentType,
    customMetadata: {
      ...extraMetadata,
      uploadedBy,
    },
  };
  const r = storageRef(fullPath);
  await uploadBytes(r, data, metadata);
  const downloadUrl = await getDownloadURL(r);
  return { fullPath, downloadUrl };
}

export async function getStorageDownloadUrl(fullPath: string): Promise<string> {
  return getDownloadURL(storageRef(fullPath));
}

export async function getStorageMetadata(fullPath: string) {
  return getMetadata(storageRef(fullPath));
}

export async function deleteStorageFile(fullPath: string): Promise<void> {
  try {
    await deleteObject(storageRef(fullPath));
  } catch (err: any) {
    if (err?.code === 'storage/object-not-found') return;
    throw err;
  }
}

export async function listStorageFolder(folderPath: string): Promise<string[]> {
  const res = await listAll(storageRef(folderPath));
  return res.items.map((item) => item.fullPath);
}
