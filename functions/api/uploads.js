/**
 * Recipe API — storing a recipe's photos and step media as the user (slice 5). What to
 * store is decided by media.js (planUploads); paths and entries come from the shared
 * model, so they match what the app writes.
 *
 * File names don't trust the client's name: a photo's extension comes from its checked
 * type, and a media name is sanitized and shortened (the app's thumbnail extension and
 * deleteFiles rely on a sane extension).
 */
const { ApiError } = require('./errors');

// Loaded on first use, so the naming / cleanup logic can be tested without the SDK.
const sdk = () => require('firebase/storage');

const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};
const MAX_NAME_CHARS = 40;
// The resize extension's variants of a photo (see RecipeImageService.deleteFiles).
const PHOTO_VARIANTS = ['_400x400.webp', '_1080x1080.webp'];

/** A photo's file name for the shared builder: its extension is its checked type's. */
function photoName(mimeType) {
  return `photo.${EXTENSIONS[mimeType]}`;
}

/** A media file's name: the client's base name, sanitized and shortened, + its type's extension. */
function mediaName(filename, mimeType) {
  const base = String(filename || '')
    .replace(/\.[^.]*$/, '')
    .replace(/[^a-zA-Z0-9-]/g, '_')
    .slice(0, MAX_NAME_CHARS);
  return `${base || 'media'}.${EXTENSIONS[mimeType]}`;
}

/** A photo's thumbnail variants, which the resize extension writes next to it. */
function photoVariants(path) {
  return PHOTO_VARIANTS.map((suffix) => path.replace(/\.[^.]+$/, suffix));
}

/**
 * Upload the planned files for `recipeId` as the user; returns the recipe's `images` and
 * `mediaInstructions` entries and the uploaded paths (for cleanup). If any upload fails,
 * every upload is let finish first and all that succeeded are removed — so none is left
 * behind.
 * @param {*} session - The user session (storage, uid).
 * @param {{ upload?: Function }} [deps] - For tests: `upload(storage, path, file, meta)`.
 */
async function uploadPlanned(session, recipeId, plan, model, deps = {}) {
  const upload =
    deps.upload ||
    ((storage, path, data, metadata) => {
      const { ref, uploadBytes } = sdk();
      return uploadBytes(ref(storage, path), data, metadata);
    });
  const uploaded = [];
  const put = async (path, file) => {
    await upload(session.storage, path, file.data, {
      contentType: file.mimeType,
      customMetadata: { uploadedBy: session.uid },
    });
    uploaded.push(path);
  };

  const imageJobs = plan.images.map(async ({ file, isPrimary }) => {
    const id = model.generateImageId();
    const fileName = model.imageFileName(id, photoName(file.mimeType));
    const path = `${model.recipeImagesFolder(recipeId)}/${fileName}`;
    await put(path, file);
    return model.buildImageEntry({ id, path, fileName, isPrimary, uploadedBy: session.uid });
  });
  const mediaJobs = plan.media.map(async ({ file, type, caption }, order) => {
    const id = model.generateMediaInstructionId();
    const fileName = model.mediaFileName(id, mediaName(file.filename, file.mimeType));
    const path = `${model.recipeMediaFolder(recipeId)}/${fileName}`;
    await put(path, file);
    return {
      ...model.buildMediaEntry({ id, path, type, uploadedBy: session.uid }),
      caption,
      order,
    };
  });

  const settled = await Promise.allSettled([...imageJobs, ...mediaJobs]);
  const failure = settled.find((s) => s.status === 'rejected');
  if (failure) {
    await removeFiles(session, uploaded, deps);
    if (failure.reason?.code === 'storage/unauthorized') {
      throw new ApiError(403, 'forbidden', 'A file could not be stored for this user.');
    }
    throw failure.reason;
  }
  const values = settled.map((s) => s.value);
  return {
    images: values.slice(0, imageJobs.length),
    mediaInstructions: values.slice(imageJobs.length),
    uploaded,
  };
}

/**
 * Best-effort removal of uploaded files (the rules let the uploader delete them), with a
 * photo's thumbnail variants if the resize extension already made them. Variants made
 * after this runs are left for a cleanup sweep.
 * @param {{ remove?: Function }} [deps] - For tests: `remove(storage, path)`.
 */
async function removeFiles(session, paths, deps = {}) {
  const remove =
    deps.remove ||
    ((storage, path) => {
      const { ref, deleteObject } = sdk();
      return deleteObject(ref(storage, path));
    });
  const all = paths.flatMap((path) =>
    path.includes('/images/') ? [path, ...photoVariants(path)] : [path],
  );
  await Promise.all(
    all.map((path) => Promise.resolve(remove(session.storage, path)).catch(() => {})),
  );
}

module.exports = { uploadPlanned, removeFiles, photoName, mediaName, photoVariants };
