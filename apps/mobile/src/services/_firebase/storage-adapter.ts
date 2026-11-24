import * as FileSystem from 'expo-file-system';
import { deleteObject, getDownloadURL, getMetadata, listAll, ref } from 'firebase/storage';
import {
  IS_DTU_MODE,
  ensureFirebaseReady,
  getDtuBaseHost,
  getFirebaseApp,
  getFirebaseAuth,
  getFirebaseStorage,
} from './firebase-app';

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeUint8ArrayToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const len = bytes.byteLength;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const hasB1 = i + 1 < len;
    const hasB2 = i + 2 < len;
    const b1 = hasB1 ? bytes[i + 1] : 0;
    const b2 = hasB2 ? bytes[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    chunks.push(
      BASE64_CHARS[(triple >> 18) & 0x3f] +
        BASE64_CHARS[(triple >> 12) & 0x3f] +
        (hasB1 ? BASE64_CHARS[(triple >> 6) & 0x3f] : '=') +
        (hasB2 ? BASE64_CHARS[triple & 0x3f] : '='),
    );
  }
  return chunks.join('');
}

function decodeBase64ToUint8Array(input: string): Uint8Array {
  const cleaned = input.replace(/^data:[^;]+;base64,/, '').replace(/[^A-Za-z0-9+/=]/g, '');
  const len = cleaned.length;
  let padding = 0;
  if (len >= 2 && cleaned[len - 1] === '=') padding += 1;
  if (len >= 2 && cleaned[len - 2] === '=') padding += 1;
  const byteLen = Math.max(0, Math.floor((len * 3) / 4) - padding);
  const out = new Uint8Array(byteLen);

  let outIdx = 0;
  for (let i = 0; i < len; i += 4) {
    const c1 = BASE64_CHARS.indexOf(cleaned[i] || 'A');
    const c2 = BASE64_CHARS.indexOf(cleaned[i + 1] || 'A');
    const c3 = cleaned[i + 2] === '=' ? 0 : BASE64_CHARS.indexOf(cleaned[i + 2] || 'A');
    const c4 = cleaned[i + 3] === '=' ? 0 : BASE64_CHARS.indexOf(cleaned[i + 3] || 'A');
    if (c1 < 0 || c2 < 0 || c3 < 0 || c4 < 0) continue;
    const triple = (c1 << 18) | (c2 << 12) | (c3 << 6) | c4;
    if (outIdx < byteLen) out[outIdx++] = (triple >> 16) & 0xff;
    if (outIdx < byteLen) out[outIdx++] = (triple >> 8) & 0xff;
    if (outIdx < byteLen) out[outIdx++] = triple & 0xff;
  }
  return out;
}

function utf8ToBytes(str: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i += 1) {
    let codePoint = str.charCodeAt(i);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = ((codePoint - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
        i += 1;
      }
    }
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read Blob for Storage upload'));
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(decodeBase64ToUint8Array(result));
    };
    reader.readAsDataURL(blob);
  });
}

function getStorageApiOrigin(): string {
  if (IS_DTU_MODE) {
    return `http://${getDtuBaseHost()}:9199`;
  }
  return 'https://firebasestorage.googleapis.com';
}

function getStorageBucketName(): string {
  const bucket = getFirebaseApp().options.storageBucket || 'demo-cookbook.appspot.com';
  return bucket.replace(/^gs:\/\//, '').replace(/\/+$/, '');
}

export function storageRef(fullPath: string) {
  ensureFirebaseReady();
  return ref(getFirebaseStorage(), fullPath);
}

/**
 * INV-P0-05: Every client Storage upload MUST carry `customMetadata.uploadedBy`.
 *
 * Uses Firebase Storage's official 1-shot RFC 2387 `multipart/related` upload
 * streamed natively via `expo-file-system` `FileSystem.uploadAsync`, avoiding
 * React Native Hermes' unsupported `new Blob([ArrayBufferView])` inside
 * `@firebase/storage` while setting both `contentType` and `metadata.uploadedBy`
 * atomically on both the local DTU Storage Emulator and live Firebase Storage.
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

  ensureFirebaseReady();
  const normalizedPath = fullPath.replace(/^\/+/, '');
  const origin = getStorageApiOrigin();
  const bucket = getStorageBucketName();

  const rawBytes = data instanceof Uint8Array ? data : await blobToUint8Array(data);
  const currentUser = getFirebaseAuth().currentUser;
  const idToken = currentUser ? await currentUser.getIdToken() : null;
  const authHeader: Record<string, string> = idToken
    ? { Authorization: `Firebase ${idToken}` }
    : {};

  const boundary = `cookbook_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const metadataJson = JSON.stringify({
    name: normalizedPath,
    contentType,
    metadata: {
      ...extraMetadata,
      uploadedBy: uploadedBy.trim(),
    },
  });

  const preamble =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=utf-8\r\n\r\n` +
    `${metadataJson}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`;
  const epilogue = `\r\n--${boundary}--`;

  const preambleBytes = utf8ToBytes(preamble);
  const epilogueBytes = utf8ToBytes(epilogue);
  const bodyBytes = new Uint8Array(
    preambleBytes.byteLength + rawBytes.byteLength + epilogueBytes.byteLength,
  );
  bodyBytes.set(preambleBytes, 0);
  bodyBytes.set(rawBytes, preambleBytes.byteLength);
  bodyBytes.set(epilogueBytes, preambleBytes.byteLength + rawBytes.byteLength);

  const cacheDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!cacheDir) {
    throw new Error('No writable cache directory available for Storage upload');
  }
  const tempPath = `${cacheDir}fb-mp-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`;

  try {
    await FileSystem.writeAsStringAsync(tempPath, encodeUint8ArrayToBase64(bodyBytes), {
      encoding: FileSystem.EncodingType.Base64,
    });

    const uploadUrl = `${origin}/v0/b/${encodeURIComponent(bucket)}/o?name=${encodeURIComponent(
      normalizedPath,
    )}`;

    const uploadRes = await FileSystem.uploadAsync(uploadUrl, tempPath, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'X-Goog-Upload-Protocol': 'multipart',
        ...authHeader,
      },
    });

    if (uploadRes.status < 200 || uploadRes.status >= 300) {
      throw new Error(
        `Storage multipart upload failed (${uploadRes.status}): ${uploadRes.body || ''}`,
      );
    }

    let downloadUrl: string | null = null;
    try {
      const parsed = JSON.parse(uploadRes.body || '{}');
      const token =
        typeof parsed?.downloadTokens === 'string'
          ? parsed.downloadTokens.split(',')[0]?.trim()
          : '';
      if (token) {
        downloadUrl = `${origin}/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(
          normalizedPath,
        )}?alt=media&token=${encodeURIComponent(token)}`;
      }
    } catch {
      // Fallback to SDK getDownloadURL below
    }

    if (!downloadUrl) {
      downloadUrl = await getDownloadURL(storageRef(normalizedPath));
    }

    return { fullPath: normalizedPath, downloadUrl };
  } finally {
    await FileSystem.deleteAsync(tempPath, { idempotent: true }).catch(() => {});
  }
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
