import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import {
  buildImageEntry,
  buildMediaEntry,
  generateImageId,
  generateMediaInstructionId,
  imageFileName,
  mediaFileName,
  mediaTypeOf,
  STAGE,
  submissionRecord,
  suggestionImagesFolder,
  suggestionMediaFolder,
  VISIBILITY,
  withModelFields,
} from '@cookbook/core/recipe-model';
import { buildApplyPayload } from '@cookbook/core/recipe-utils/recipe-diff-utils';
import { rewriteStoragePaths } from '@cookbook/core/recipe-utils/storage-paths';
import {
  createWriteBatch,
  deleteField,
  docRef,
  generateDocId,
  getDocument,
  listDocuments,
  serverTimestamp,
  setDocument,
  updateDocument,
  where,
} from '../_firebase/firestore-adapter';
import { callCloudFunction } from '../_firebase/functions-adapter';
import { uploadBlobWithOwner } from '../_firebase/storage-adapter';
import { captureError } from '../logger';
import { MediaInstructionService } from './media-instruction-service';
import { RecipeImageService } from './recipe-image-service';
import { RecipeService } from './recipe-service';

const COLLECTION = 'recipe_edit_suggestions';
const RECIPES_COLLECTION = 'recipes';
const SUBMISSIONS_COLLECTION = 'recipe_submissions';
const MAX_BASE64_READ_BYTES = 8 * 1024 * 1024;

export interface StagedStoragePath {
  type: 'image' | 'media';
  path: string;
}

export interface RecipeEditSuggestionDoc {
  id: string;
  recipeId: string;
  recipeName: string;
  suggestedBy: string;
  suggestedByName?: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'superseded';
  proposedChanges: Record<string, any>;
  storagePaths: StagedStoragePath[];
  note?: string | null;
  rejectionReason?: string | null;
  reviewedBy?: string | null;
  createdAt?: any;
  reviewedAt?: any;
}

export interface LocalImageUploadInput {
  id?: string;
  source?: 'new' | 'existing';
  localUri?: string;
  blob?: Blob | Uint8Array;
  fileName?: string;
  contentType?: string;
  isPrimary?: boolean;
  // Existing persisted fields
  full?: string;
  url?: string;
  uploadedBy?: string;
  access?: string;
  uploadTimestamp?: any;
  [key: string]: any;
}

export interface LocalMediaUploadInput {
  id?: string;
  source?: 'new' | 'existing';
  localUri?: string;
  blob?: Blob | Uint8Array;
  fileName?: string;
  contentType?: string;
  type?: 'image' | 'video';
  caption?: string;
  order?: number;
  // Existing persisted fields
  path?: string;
  url?: string;
  uploadedBy?: string;
  uploadedAt?: any;
  [key: string]: any;
}

export interface MediaUploadSummary {
  successCount: number;
  failedCount: number;
  totalPending: number;
}

export interface UploadStagedFileParams {
  suggestionId: string;
  kind: 'image' | 'media';
  uri?: string;
  blob?: Blob | Uint8Array;
  fileName?: string;
  contentType?: string;
  uploadedBy: string;
}

export interface UploadStagedFileResult {
  id: string;
  path: string;
  fileName: string;
  downloadUrl: string;
  kind: 'image' | 'media';
  mediaType?: 'image' | 'video';
}

export interface CreateSuggestionParams {
  recipeId: string;
  suggestedBy: string;
  suggestedByName?: string;
  proposedChanges: Record<string, any>;
  mediaItemsOrdered?: LocalMediaUploadInput[];
  note?: string;
}

export interface CreateRecipeAtomicParams {
  recipeData: Record<string, any>;
  imagesToUpload?: LocalImageUploadInput[];
  mediaItemsOrdered?: LocalMediaUploadInput[];
  uploadedBy: string;
  authorName?: string;
  submitForApproval: boolean;
  directPublish?: boolean;
}

export interface UpdateRecipeWithAssetsParams {
  changes: Record<string, any>;
  images?: LocalImageUploadInput[];
  imagesToDelete?: Array<Record<string, any>>;
  mediaItemsOrdered?: LocalMediaUploadInput[];
  mediaToDelete?: string[];
  uploadedBy: string;
  directPublish?: boolean;
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

/**
 * Reads a local Expo URI (`file://`, `content://`, `data:`) into binary bytes
 * compatible with Firebase JS SDK `uploadBytes` on both Android and iOS Hermes.
 */
async function readLocalUriToBytes(uri: string): Promise<Uint8Array | Blob> {
  if (!uri) throw new Error('Empty local file URI');
  if (uri.startsWith('data:')) {
    return decodeBase64ToUint8Array(uri);
  }

  if (uri.startsWith('file://')) {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      const size = info.exists && 'size' in info && typeof info.size === 'number' ? info.size : 0;
      if (size === 0 || size <= MAX_BASE64_READ_BYTES) {
        const b64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        return decodeBase64ToUint8Array(b64);
      }
    } catch {
      // Fall through to fetch
    }
  }

  const response = await fetch(uri);
  if (typeof response.arrayBuffer === 'function') {
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }
  return response.blob();
}

function createSafeMediaId(): string {
  try {
    return generateMediaInstructionId();
  } catch {
    return `media-${Crypto.randomUUID()}`;
  }
}

function inferExtFromNameOrMime(fileName?: string, contentType?: string): string {
  if (fileName && fileName.includes('.')) {
    const ext = fileName
      .split('.')
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    if (ext) return ext;
  }
  const mime = (contentType || '').toLowerCase();
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'video/mp4') return 'mp4';
  if (mime === 'video/webm') return 'webm';
  if (mime === 'video/quicktime') return 'mov';
  return 'jpg';
}

function inferImageContentType(fileName?: string, contentType?: string): string {
  if (contentType && contentType.startsWith('image/')) return contentType;
  const ext = inferExtFromNameOrMime(fileName, contentType);
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

function inferMediaContentType(
  fileName?: string,
  contentType?: string,
  type?: 'image' | 'video',
): string {
  if (contentType && (contentType.startsWith('image/') || contentType.startsWith('video/'))) {
    return contentType;
  }
  const ext = inferExtFromNameOrMime(fileName, contentType);
  if (ext === 'mp4') return 'video/mp4';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return type === 'video' ? 'video/mp4' : 'image/jpeg';
}

/**
 * Recursively strips `undefined` values while leaving non-plain objects
 * (Firestore FieldValue sentinels like `serverTimestamp()`/`deleteField()`,
 * Timestamps, Dates) untouched.
 */
function stripUndefinedDeep(value: any): any {
  if (Array.isArray(value)) {
    return value.filter((v) => v !== undefined).map(stripUndefinedDeep);
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = stripUndefinedDeep(v);
    }
    return out;
  }
  return value;
}

function timestampMillis(value: any): number {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function cleanExistingImageEntry(img: Record<string, any>): Record<string, any> {
  const {
    source: _s,
    localUri: _u,
    blob: _b,
    preview: _p,
    file: _f,
    contentType: _ct,
    ...rest
  } = img;
  return stripUndefinedDeep({
    ...rest,
    isPrimary: Boolean(img.isPrimary),
  });
}

function cleanExistingMediaEntry(item: Record<string, any>, order: number): Record<string, any> {
  const {
    source: _s,
    localUri: _u,
    blob: _b,
    preview: _p,
    file: _f,
    contentType: _ct,
    position: _pos,
    pending: _pend,
    ...rest
  } = item;
  return stripUndefinedDeep({
    ...rest,
    caption: typeof item.caption === 'string' ? item.caption.trim() : '',
    order,
  });
}

async function deleteSuggestionStorage(storagePaths?: StagedStoragePath[]): Promise<void> {
  const paths = Array.isArray(storagePaths) ? storagePaths : [];
  await Promise.all(
    paths.map((entry) => {
      if (!entry?.path) return Promise.resolve();
      if (entry.type === 'media') {
        return MediaInstructionService.deleteMediaInstruction(entry.path).catch(() => {});
      }
      return RecipeImageService.deleteRecipeImages('suggestion', [{ full: entry.path }]).catch(
        () => {},
      );
    }),
  );
}

/**
 * Creates a new recipe document (plus optional `recipe_submissions/{id}` in a SINGLE
 * atomic Firestore WriteBatch — required by `firestore.rules` `submittedTogether(recipeId)`).
 *
 * All recipe photos upload to `recipes/{recipeId}/images/{imgId}.{ext}` and step media
 * to `recipes/{recipeId}/media/{mediaId}_{sanitizedName}` with mandatory `uploadedBy: uid`
 * (INV-P0-05).
 */
export async function createRecipeAtomic({
  recipeData,
  imagesToUpload = [],
  mediaItemsOrdered = [],
  uploadedBy,
  authorName,
  submitForApproval,
  directPublish = false,
}: CreateRecipeAtomicParams): Promise<{
  recipeId: string;
  mediaUploadResults: MediaUploadSummary;
}> {
  if (!uploadedBy || !uploadedBy.trim()) {
    throw new Error('createRecipeAtomic: uploadedBy UID is required');
  }
  if (!recipeData || typeof recipeData !== 'object') {
    throw new Error('createRecipeAtomic: recipeData is required');
  }

  const recipeId = RecipeService.generateId();
  const uploadedImages: Array<Record<string, any>> = [];
  const uploadedMediaPaths: string[] = [];

  try {
    // 1. Upload recipe photos to recipes/{recipeId}/images/...
    for (const img of imagesToUpload) {
      if (!img) continue;
      if (img.localUri || img.blob) {
        const bytes = img.blob ?? (await readLocalUriToBytes(img.localUri!));
        const ext = inferExtFromNameOrMime(img.fileName || img.localUri, img.contentType);
        const contentType = inferImageContentType(img.fileName || img.localUri, img.contentType);
        const entry = await RecipeImageService.uploadRecipeImage(recipeId, uploadedBy, bytes, {
          ext,
          contentType,
          isPrimary: Boolean(img.isPrimary),
        });
        uploadedImages.push(stripUndefinedDeep(entry));
      } else if (img.full) {
        uploadedImages.push(cleanExistingImageEntry(img));
      }
    }

    // Ensure at least one photo is marked primary when photos exist
    if (uploadedImages.length > 0 && !uploadedImages.some((i) => i.isPrimary)) {
      uploadedImages[0].isPrimary = true;
    }

    // 2. Upload step media to recipes/{recipeId}/media/...
    const processedMedia: Array<Record<string, any>> = [];
    let successCount = 0;
    let failedCount = 0;
    let totalPending = 0;
    let order = 0;

    for (const item of mediaItemsOrdered) {
      if (!item) continue;
      if (item.localUri || item.blob) {
        totalPending += 1;
        try {
          const bytes = item.blob ?? (await readLocalUriToBytes(item.localUri!));
          const contentType = inferMediaContentType(
            item.fileName || item.localUri,
            item.contentType,
            item.type,
          );
          const mediaType = item.type || mediaTypeOf(contentType) || 'image';
          const fileName =
            item.fileName || `step.${inferExtFromNameOrMime(item.localUri, contentType)}`;
          const entry = await MediaInstructionService.uploadMediaInstruction(
            recipeId,
            uploadedBy,
            bytes,
            {
              fileName,
              contentType,
              type: mediaType,
              caption: item.caption || '',
              order,
            },
          );
          uploadedMediaPaths.push(entry.path);
          processedMedia.push(stripUndefinedDeep(entry));
          successCount += 1;
          order += 1;
        } catch (mediaErr) {
          failedCount += 1;
          captureError(mediaErr, {
            service: 'recipe-authoring',
            op: 'uploadStepMedia',
            recipeId,
          });
        }
      } else if (item.path) {
        processedMedia.push(cleanExistingMediaEntry(item, order));
        order += 1;
      }
    }

    // 3. Build normalized Firestore recipe document
    const baseModel = withModelFields(
      stripUndefinedDeep({
        ...recipeData,
        authorId: uploadedBy,
        visibility: directPublish ? VISIBILITY.PUBLISHED : VISIBILITY.PRIVATE,
        stage: recipeData.stage || STAGE.TESTED,
      }),
    );

    const recipePayload: Record<string, any> = stripUndefinedDeep({
      ...baseModel,
      creationTime: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...(uploadedImages.length > 0 ? { images: uploadedImages } : {}),
      ...(processedMedia.length > 0 ? { mediaInstructions: processedMedia } : {}),
    });

    // 4. Single atomic WriteBatch committing BOTH recipes/{id} AND recipe_submissions/{id}
    const batch = createWriteBatch();
    batch.set(docRef(RECIPES_COLLECTION, recipeId), recipePayload);

    if (submitForApproval) {
      const baseSubmission = submissionRecord({
        recipeId,
        authorId: uploadedBy,
        createdAt: serverTimestamp(),
      });
      const submissionPayload = stripUndefinedDeep({
        ...baseSubmission,
        submittedAt: serverTimestamp(),
        ...(recipePayload.name ? { recipeName: recipePayload.name } : {}),
        ...(authorName ? { authorName } : {}),
        ...(recipePayload.category ? { category: recipePayload.category } : {}),
      });
      batch.set(docRef(SUBMISSIONS_COLLECTION, recipeId), submissionPayload);
    }

    await batch.commit();

    return {
      recipeId,
      mediaUploadResults: { successCount, failedCount, totalPending },
    };
  } catch (err) {
    // Best-effort cleanup of newly uploaded Storage assets on failure
    if (uploadedImages.length > 0) {
      await RecipeImageService.deleteRecipeImages(recipeId, uploadedImages).catch(() => {});
    }
    if (uploadedMediaPaths.length > 0) {
      await MediaInstructionService.deleteMany(uploadedMediaPaths).catch(() => {});
    }
    captureError(err, {
      service: 'recipe-authoring',
      op: 'createRecipeAtomic',
      recipeId,
      submitForApproval,
    });
    throw err;
  }
}

/**
 * Updates an existing recipe with deferred Storage deletion:
 * uploads new photos/media first, writes the Firestore update via `RecipeService.update`,
 * and only deletes removed Storage files AFTER the Firestore update succeeds.
 */
export async function updateRecipeWithAssets(
  recipeId: string,
  {
    changes,
    images,
    imagesToDelete = [],
    mediaItemsOrdered,
    mediaToDelete = [],
    uploadedBy,
    directPublish,
  }: UpdateRecipeWithAssetsParams,
): Promise<{ mediaUploadResults: MediaUploadSummary }> {
  if (!recipeId) throw new Error('updateRecipeWithAssets: recipeId is required');
  if (!uploadedBy) throw new Error('updateRecipeWithAssets: uploadedBy is required');

  const newlyUploadedImages: Array<Record<string, any>> = [];
  const newlyUploadedMediaPaths: string[] = [];

  try {
    let nextImages: Array<Record<string, any>> | undefined;
    if (Array.isArray(images)) {
      nextImages = [];
      for (const img of images) {
        if (!img) continue;
        if ((img.source === 'new' || !img.full) && (img.localUri || img.blob)) {
          const bytes = img.blob ?? (await readLocalUriToBytes(img.localUri!));
          const ext = inferExtFromNameOrMime(img.fileName || img.localUri, img.contentType);
          const contentType = inferImageContentType(img.fileName || img.localUri, img.contentType);
          const entry = await RecipeImageService.uploadRecipeImage(recipeId, uploadedBy, bytes, {
            ext,
            contentType,
            isPrimary: Boolean(img.isPrimary),
          });
          const cleanedEntry = stripUndefinedDeep(entry);
          newlyUploadedImages.push(cleanedEntry);
          nextImages.push(cleanedEntry);
        } else if (img.full || img.url) {
          nextImages.push(cleanExistingImageEntry(img));
        }
      }
      if (nextImages.length > 0 && !nextImages.some((i) => i.isPrimary)) {
        nextImages[0].isPrimary = true;
      }
    }

    let nextMedia: Array<Record<string, any>> | undefined;
    let successCount = 0;
    let failedCount = 0;
    let totalPending = 0;

    if (Array.isArray(mediaItemsOrdered)) {
      nextMedia = [];
      let order = 0;
      for (const item of mediaItemsOrdered) {
        if (!item) continue;
        if ((item.source === 'new' || !item.path) && (item.localUri || item.blob)) {
          totalPending += 1;
          try {
            const bytes = item.blob ?? (await readLocalUriToBytes(item.localUri!));
            const contentType = inferMediaContentType(
              item.fileName || item.localUri,
              item.contentType,
              item.type,
            );
            const mediaType = item.type || mediaTypeOf(contentType) || 'image';
            const fileName =
              item.fileName || `step.${inferExtFromNameOrMime(item.localUri, contentType)}`;
            const entry = await MediaInstructionService.uploadMediaInstruction(
              recipeId,
              uploadedBy,
              bytes,
              {
                fileName,
                contentType,
                type: mediaType,
                caption: item.caption || '',
                order,
              },
            );
            newlyUploadedMediaPaths.push(entry.path);
            nextMedia.push(stripUndefinedDeep(entry));
            successCount += 1;
            order += 1;
          } catch (mediaErr) {
            failedCount += 1;
            captureError(mediaErr, {
              service: 'recipe-authoring',
              op: 'updateStepMedia',
              recipeId,
            });
          }
        } else if (item.path) {
          nextMedia.push(cleanExistingMediaEntry(item, order));
          order += 1;
        }
      }
    }

    const docPayload: Record<string, any> = stripUndefinedDeep({ ...changes });

    // Cleanly switch between flat & sectioned/staged formats via deleteField()
    if (Array.isArray(changes.ingredientSections) && changes.ingredientSections.length > 0) {
      docPayload.ingredients = deleteField();
    } else if (Array.isArray(changes.ingredients)) {
      docPayload.ingredientSections = deleteField();
    }

    if (Array.isArray(changes.stages) && changes.stages.length > 0) {
      docPayload.instructions = deleteField();
    } else if (Array.isArray(changes.instructions)) {
      docPayload.stages = deleteField();
    }

    if (nextImages !== undefined) {
      docPayload.images = nextImages;
    }
    if (nextMedia !== undefined) {
      docPayload.mediaInstructions = nextMedia;
    }
    if (directPublish === true) {
      docPayload.visibility = VISIBILITY.PUBLISHED;
    }

    await RecipeService.update(recipeId, docPayload);

    // Deferred best-effort cleanup of removed Storage files after save succeeded
    if (imagesToDelete.length > 0) {
      await RecipeImageService.deleteRecipeImages(recipeId, imagesToDelete).catch(() => {});
    }
    if (mediaToDelete.length > 0) {
      await MediaInstructionService.deleteMany(mediaToDelete).catch(() => {});
    }

    return {
      mediaUploadResults: { successCount, failedCount, totalPending },
    };
  } catch (err) {
    if (newlyUploadedImages.length > 0) {
      await RecipeImageService.deleteRecipeImages(recipeId, newlyUploadedImages).catch(() => {});
    }
    if (newlyUploadedMediaPaths.length > 0) {
      await MediaInstructionService.deleteMany(newlyUploadedMediaPaths).catch(() => {});
    }
    captureError(err, {
      service: 'recipe-authoring',
      op: 'updateRecipeWithAssets',
      recipeId,
    });
    throw err;
  }
}

export const RecipeEditSuggestionService = {
  /**
   * Uploads a staged image or step media file into
   * `suggestions/${suggestionId}/images|media/...` with mandatory `uploadedBy: uid`
   * (INV-P0-05).
   */
  async uploadStagedFile({
    suggestionId,
    kind,
    uri,
    blob,
    fileName,
    contentType,
    uploadedBy,
  }: UploadStagedFileParams): Promise<UploadStagedFileResult> {
    if (!suggestionId) {
      throw new Error('RecipeEditSuggestionService.uploadStagedFile: suggestionId is required');
    }
    if (!uploadedBy || !uploadedBy.trim()) {
      throw new Error('RecipeEditSuggestionService.uploadStagedFile: uploadedBy is required');
    }
    if (!blob && !uri) {
      throw new Error('RecipeEditSuggestionService.uploadStagedFile: uri or blob is required');
    }

    const bytes = blob ?? (await readLocalUriToBytes(uri!));

    if (kind === 'image') {
      const id = generateImageId();
      const ext = inferExtFromNameOrMime(fileName || uri, contentType);
      const resolvedMime = inferImageContentType(fileName || uri, contentType);
      const generatedName = imageFileName(id, `photo.${ext}`);
      const fullPath = `${suggestionImagesFolder(suggestionId)}/${generatedName}`;

      const { downloadUrl } = await uploadBlobWithOwner(fullPath, bytes, {
        uploadedBy,
        contentType: resolvedMime,
      });

      return {
        id,
        path: fullPath,
        fileName: generatedName,
        downloadUrl,
        kind: 'image',
      };
    }

    const id = createSafeMediaId();
    const resolvedMime = inferMediaContentType(fileName || uri, contentType);
    const resolvedMediaType = mediaTypeOf(resolvedMime) || 'image';
    const ext = inferExtFromNameOrMime(fileName || uri, resolvedMime);
    const origName = fileName || `step.${ext}`;
    const generatedName = mediaFileName(id, origName);
    const fullPath = `${suggestionMediaFolder(suggestionId)}/${generatedName}`;

    const { downloadUrl } = await uploadBlobWithOwner(fullPath, bytes, {
      uploadedBy,
      contentType: resolvedMime,
    });

    return {
      id,
      path: fullPath,
      fileName: generatedName,
      downloadUrl,
      kind: 'media',
      mediaType: resolvedMediaType,
    };
  },

  /**
   * Creates a pending edit suggestion with a FULL recipe snapshot in `proposedChanges`
   * (always preserving `images[]` and `mediaInstructions[]`, even when empty) plus
   * staged Storage uploads under `suggestions/${suggestionId}/images|media/...`.
   */
  async create({
    recipeId,
    suggestedBy,
    suggestedByName,
    proposedChanges,
    mediaItemsOrdered,
    note,
  }: CreateSuggestionParams): Promise<{ suggestionId: string }> {
    if (!recipeId) {
      throw new Error('RecipeEditSuggestionService.create: recipeId is required');
    }
    if (!suggestedBy) {
      throw new Error('RecipeEditSuggestionService.create: suggestedBy is required');
    }
    if (!proposedChanges || typeof proposedChanges !== 'object') {
      throw new Error('RecipeEditSuggestionService.create: proposedChanges is required');
    }

    const liveRecipe = await RecipeService.getById(recipeId);
    if (!liveRecipe) {
      throw new Error(`RecipeEditSuggestionService.create: recipe ${recipeId} not found`);
    }

    const suggestionId = generateDocId(COLLECTION);

    const {
      images: formImages = [],
      mediaInstructions: fallbackMedia,
      toDelete: _ignoredToDelete,
      imagesToDelete: _ignoredImagesToDelete,
      mediaToDelete: _ignoredMediaToDelete,
      ...baseFields
    } = proposedChanges;

    const storagePaths: StagedStoragePath[] = [];

    try {
      const processedImages: Array<Record<string, any>> = [];
      for (const img of Array.isArray(formImages) ? formImages : []) {
        if (!img) continue;
        if ((img.source === 'new' || !img.full) && (img.localUri || img.blob)) {
          const uploaded = await RecipeEditSuggestionService.uploadStagedFile({
            suggestionId,
            kind: 'image',
            uri: img.localUri,
            blob: img.blob,
            fileName: img.fileName,
            contentType: img.contentType,
            uploadedBy: suggestedBy,
          });
          storagePaths.push({ type: 'image', path: uploaded.path });
          const entry = buildImageEntry({
            id: uploaded.id,
            path: uploaded.path,
            fileName: uploaded.fileName,
            isPrimary: Boolean(img.isPrimary),
            uploadedBy: suggestedBy,
          });
          processedImages.push(stripUndefinedDeep({ ...entry, url: uploaded.downloadUrl }));
        } else if (img.full || img.url) {
          processedImages.push(cleanExistingImageEntry(img));
        }
      }

      const orderedMedia = Array.isArray(mediaItemsOrdered)
        ? mediaItemsOrdered
        : Array.isArray(fallbackMedia)
          ? fallbackMedia
          : [];
      const processedMedia: Array<Record<string, any>> = [];
      let order = 0;

      for (const item of orderedMedia) {
        if (!item) continue;
        if ((item.source === 'new' || !item.path) && (item.localUri || item.blob)) {
          const uploaded = await RecipeEditSuggestionService.uploadStagedFile({
            suggestionId,
            kind: 'media',
            uri: item.localUri,
            blob: item.blob,
            fileName: item.fileName,
            contentType: item.contentType,
            uploadedBy: suggestedBy,
          });
          storagePaths.push({ type: 'media', path: uploaded.path });
          const entry = buildMediaEntry({
            id: uploaded.id,
            path: uploaded.path,
            type: item.type || uploaded.mediaType || 'image',
            uploadedBy: suggestedBy,
          });
          processedMedia.push(
            stripUndefinedDeep({
              ...entry,
              caption: typeof item.caption === 'string' ? item.caption.trim() : '',
              order,
              url: uploaded.downloadUrl,
            }),
          );
          order += 1;
        } else if (item.path) {
          processedMedia.push(cleanExistingMediaEntry(item, order));
          order += 1;
        }
      }

      // Full recipe snapshot — ALWAYS includes images[] & mediaInstructions[]
      const storedChanges = stripUndefinedDeep({
        ...baseFields,
        images: processedImages,
        mediaInstructions: processedMedia,
      });

      const docPayload = stripUndefinedDeep({
        recipeId,
        recipeName: liveRecipe.name || baseFields.name || '',
        suggestedBy,
        suggestedByName: suggestedByName || null,
        status: 'pending',
        proposedChanges: storedChanges,
        storagePaths,
        note: typeof note === 'string' && note.trim() ? note.trim() : null,
        rejectionReason: null,
        reviewedBy: null,
        createdAt: serverTimestamp(),
        reviewedAt: null,
      });

      await setDocument(COLLECTION, docPayload, { merge: false }, suggestionId);
      return { suggestionId };
    } catch (err) {
      await deleteSuggestionStorage(storagePaths);
      captureError(err, {
        service: 'recipe-edit-suggestion',
        op: 'create',
        recipeId,
        uid: suggestedBy,
      });
      throw err;
    }
  },

  async get(suggestionId: string): Promise<RecipeEditSuggestionDoc | null> {
    if (!suggestionId) return null;
    return getDocument<RecipeEditSuggestionDoc>(COLLECTION, suggestionId);
  },

  /**
   * Lists all pending suggestions, newest first (sorted client-side, no composite index).
   */
  async listPending(): Promise<RecipeEditSuggestionDoc[]> {
    const items = await listDocuments<RecipeEditSuggestionDoc>(COLLECTION, [
      where('status', '==', 'pending'),
    ]);
    return [...items].sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));
  },

  /**
   * Lists all edit suggestions for a specific recipe, newest first.
   */
  async listByRecipe(recipeId: string): Promise<RecipeEditSuggestionDoc[]> {
    if (!recipeId) return [];
    const items = await listDocuments<RecipeEditSuggestionDoc>(COLLECTION, [
      where('recipeId', '==', recipeId),
    ]);
    return [...items].sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));
  },

  /**
   * Calls `promoteSuggestionFiles` Cloud Function (manager only, idempotent) to copy
   * staged files from `suggestions/${id}/...` into `recipes/${recipeId}/...` and
   * rewrites `proposedChanges` paths with the returned mapping.
   */
  async promoteFiles(suggestion: RecipeEditSuggestionDoc): Promise<Record<string, any>> {
    const prefix = `suggestions/${suggestion.id}/`;
    const hasStagedFiles = (suggestion.storagePaths || []).some((entry) =>
      entry?.path?.startsWith(prefix),
    );
    if (!hasStagedFiles) return suggestion.proposedChanges;

    const data = await callCloudFunction<
      { suggestionId: string },
      { mapping?: Record<string, string> }
    >('promoteSuggestionFiles', { suggestionId: suggestion.id });
    return rewriteStoragePaths(suggestion.proposedChanges, data?.mapping || {});
  },

  /**
   * Manager approval workflow:
   * 1. Promotes staged files via `promoteSuggestionFiles` callable.
   * 2. Computes apply payload via `buildApplyPayload(liveRecipe, promotedChanges)`.
   * 3. Applies changes to the live recipe via `RecipeService.update` + cleans removed live files.
   * 4. Marks suggestion as `approved` and deletes staged files under `suggestions/${id}/...`.
   * 5. Supersedes sibling pending suggestions for the same recipe.
   */
  async approve(
    suggestionId: string,
    {
      reviewedBy,
      recipeId,
      skipRecipeApply = false,
    }: { reviewedBy?: string; recipeId?: string; skipRecipeApply?: boolean } = {},
  ): Promise<void> {
    if (!suggestionId) {
      throw new Error('RecipeEditSuggestionService.approve: suggestionId is required');
    }

    const suggestion = await getDocument<RecipeEditSuggestionDoc>(COLLECTION, suggestionId);
    if (!suggestion) {
      throw new Error('Suggestion not found');
    }

    const targetRecipeId = recipeId || suggestion.recipeId;

    if (!skipRecipeApply && targetRecipeId) {
      const promotedChanges = await RecipeEditSuggestionService.promoteFiles(suggestion);
      const liveRecipe = (await RecipeService.getById(targetRecipeId)) || {};
      const applyPayload = buildApplyPayload(liveRecipe, promotedChanges);

      const updatePayload: Record<string, any> = stripUndefinedDeep({
        ...(applyPayload.changes || {}),
      });

      if (
        Array.isArray(applyPayload.changes?.ingredientSections) &&
        applyPayload.changes.ingredientSections.length > 0
      ) {
        updatePayload.ingredients = deleteField();
      } else if (Array.isArray(applyPayload.changes?.ingredients)) {
        updatePayload.ingredientSections = deleteField();
      }

      if (Array.isArray(applyPayload.changes?.stages) && applyPayload.changes.stages.length > 0) {
        updatePayload.instructions = deleteField();
      } else if (Array.isArray(applyPayload.changes?.instructions)) {
        updatePayload.stages = deleteField();
      }

      if (Array.isArray(applyPayload.images)) {
        updatePayload.images = applyPayload.images.map(cleanExistingImageEntry);
      }

      if (Array.isArray(applyPayload.mediaItemsOrdered)) {
        updatePayload.mediaInstructions = applyPayload.mediaItemsOrdered.map(
          (item: Record<string, any>, idx: number) => cleanExistingMediaEntry(item, idx),
        );
      }

      await RecipeService.update(targetRecipeId, updatePayload);

      if (Array.isArray(applyPayload.imagesToDelete) && applyPayload.imagesToDelete.length > 0) {
        await RecipeImageService.deleteRecipeImages(
          targetRecipeId,
          applyPayload.imagesToDelete,
        ).catch(() => {});
      }
      if (Array.isArray(applyPayload.mediaToDelete) && applyPayload.mediaToDelete.length > 0) {
        await MediaInstructionService.deleteMany(applyPayload.mediaToDelete).catch(() => {});
      }
    }

    await updateDocument(
      COLLECTION,
      {
        status: 'approved',
        reviewedBy: reviewedBy || null,
        reviewedAt: serverTimestamp(),
      },
      suggestionId,
    );

    const staged = (suggestion.storagePaths || []).filter((entry) =>
      entry?.path?.startsWith(`suggestions/${suggestionId}/`),
    );
    if (staged.length > 0) {
      await deleteSuggestionStorage(staged);
    }

    if (targetRecipeId) {
      await RecipeEditSuggestionService.supersedePending(targetRecipeId, {
        exceptId: suggestionId,
        reviewedBy,
      });
    }
  },

  /**
   * Marks all OTHER pending suggestions for `recipeId` as `superseded` and deletes their staged files.
   */
  async supersedePending(
    recipeId: string,
    { exceptId, reviewedBy }: { exceptId?: string; reviewedBy?: string } = {},
  ): Promise<number> {
    if (!recipeId) return 0;
    const all = await listDocuments<RecipeEditSuggestionDoc>(COLLECTION, [
      where('recipeId', '==', recipeId),
    ]);
    const others = all.filter((s) => s.id !== exceptId && s.status === 'pending');
    await Promise.all(
      others.map(async (s) => {
        await deleteSuggestionStorage(s.storagePaths);
        await updateDocument(
          COLLECTION,
          {
            status: 'superseded',
            reviewedBy: reviewedBy || null,
            reviewedAt: serverTimestamp(),
          },
          s.id,
        );
      }),
    );
    return others.length;
  },

  /**
   * Rejects a pending suggestion, cleans up its staged Storage files, and stamps the document.
   */
  async reject(
    suggestionId: string,
    { reviewedBy, rejectionReason }: { reviewedBy?: string; rejectionReason?: string } = {},
  ): Promise<void> {
    if (!suggestionId) {
      throw new Error('RecipeEditSuggestionService.reject: suggestionId is required');
    }
    const suggestion = await getDocument<RecipeEditSuggestionDoc>(COLLECTION, suggestionId);
    if (!suggestion) throw new Error('Suggestion not found');

    await deleteSuggestionStorage(suggestion.storagePaths);

    await updateDocument(
      COLLECTION,
      {
        status: 'rejected',
        rejectionReason: rejectionReason?.trim() || null,
        reviewedBy: reviewedBy || null,
        reviewedAt: serverTimestamp(),
      },
      suggestionId,
    );
  },
};
