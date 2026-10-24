/**
 * Recipe API — photos and step media (docs/feature-plans/recipe-api.md §3, slice 5).
 *
 * POST /v1/recipes as multipart/form-data: a `request` part (the JSON body, plus
 * `images: [{ part, isPrimary? }]` and `mediaInstructions: [{ part, caption? }]`) and one
 * file part per referenced name. Files follow the app's rules (shared model): photos
 * are JPEG/PNG/WebP up to 5 MB, at most five, exactly one primary; step media are the
 * app's image/video types up to 50 MB — within one request of at most 30 MB (Cloud
 * Functions' cap). Each file's bytes must match its declared type.
 *
 * Uploads run in the caller's session (storage.rules: tagged with the uploader, a media
 * type, under 50 MB), to the app's layout, with the app's entry shapes.
 */
const Busboy = require('busboy');
const { badRequest, invalid, payloadTooLarge } = require('./errors');

// Cloud Functions accepts requests up to 32 MiB; leave room for the multipart framing.
const MAX_MULTIPART_BYTES = 30 * 1024 * 1024;
const MAX_FILE_PARTS = 30;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Parse a multipart body from the raw bytes.
 * @returns {Promise<{ fields: Record<string, string>, files: Map<string, {
 *   filename: string, mimeType: string, data: Buffer }> }>}
 */
function parseMultipart(req) {
  const raw = req.rawBody;
  if (!raw || raw.length === 0) throw badRequest('The body is empty.');
  if (raw.length > MAX_MULTIPART_BYTES) {
    throw payloadTooLarge(
      `One request can carry at most ${MAX_MULTIPART_BYTES / (1024 * 1024)} MB of files.`,
    );
  }
  return new Promise((resolve, reject) => {
    const fields = {};
    const files = new Map();
    let failure = null;
    let busboy;
    try {
      busboy = Busboy({
        headers: req.headers,
        limits: { files: MAX_FILE_PARTS, fields: 5, fieldSize: 1024 * 1024, parts: 40 },
      });
    } catch {
      reject(badRequest('The multipart body could not be read.'));
      return;
    }
    busboy.on('field', (name, value, info) => {
      if (info.valueTruncated) failure = badRequest(`The "${name}" part is too large.`);
      fields[name] = value;
    });
    busboy.on('file', (name, stream, info) => {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => {
        if (files.has(name)) failure = badRequest(`Two file parts are named "${name}".`);
        files.set(name, {
          filename: info.filename || name,
          mimeType: String(info.mimeType || '').toLowerCase(),
          data: Buffer.concat(chunks),
        });
      });
    });
    busboy.on('filesLimit', () => {
      failure = badRequest(`At most ${MAX_FILE_PARTS} files per request.`);
    });
    busboy.on('fieldsLimit', () => {
      failure = badRequest('Too many fields: send only the "request" part and files.');
    });
    busboy.on('partsLimit', () => {
      failure = badRequest('Too many parts.');
    });
    busboy.on('error', () => reject(badRequest('The multipart body could not be read.')));
    busboy.on('close', () => (failure ? reject(failure) : resolve({ fields, files })));
    busboy.end(raw);
  });
}

/**
 * The media type a file's first bytes show, or null: catches a file whose declared type
 * doesn't match its content (e.g. an HTML page sent as image/jpeg).
 * @param {Buffer} data
 * @returns {string|null}
 */
function sniffType(data) {
  const b = data;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (
    b.length >= 12 &&
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3)
    return 'video/webm';
  if (b.length >= 12 && b.subarray(4, 8).toString('latin1') === 'ftyp') {
    // ISO media: QuickTime brand 'qt  ', everything else treated as MP4.
    return b.subarray(8, 12).toString('latin1') === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  }
  return null;
}

/** Whether a declared type and the sniffed one agree (MP4 and QuickTime share a format). */
function typesAgree(declared, sniffed) {
  if (declared === sniffed) return true;
  const isoMedia = ['video/mp4', 'video/quicktime'];
  return isoMedia.includes(declared) && isoMedia.includes(sniffed);
}

/**
 * Check the files against the request's `images` / `mediaInstructions` and the app's
 * rules. Returns what to upload, in order; throws a 400 listing every problem.
 * @param {{ images?: *, mediaInstructions?: * }} request - The parsed `request` part.
 * @param {Map} files - From parseMultipart.
 * @param {*} model - The shared recipe model.
 */
function planUploads(request, files, model) {
  const problems = [];
  const fail = (field, message) => problems.push({ field, message });
  const used = new Set();

  const take = (entry, field) => {
    if (!isPlainObject(entry) || typeof entry.part !== 'string' || !entry.part) {
      fail(`${field}.part`, 'must name a file part');
      return null;
    }
    if (used.has(entry.part)) {
      fail(`${field}.part`, 'is already used by another entry');
      return null;
    }
    used.add(entry.part);
    const file = files.get(entry.part);
    if (!file) {
      fail(`${field}.part`, `no file part named "${entry.part}"`);
      return null;
    }
    const sniffed = sniffType(file.data);
    if (!sniffed || !typesAgree(file.mimeType, sniffed)) {
      fail(field, `the file's content does not match its type (${file.mimeType || 'none'})`);
      return null;
    }
    return file;
  };

  const images = [];
  const rawImages = request.images ?? [];
  if (!Array.isArray(rawImages)) fail('images', 'must be an array');
  else {
    if (rawImages.length > model.MAX_PHOTOS) {
      fail('images', `at most ${model.MAX_PHOTOS} photos, as in the recipe form`);
    }
    rawImages.forEach((entry, i) => {
      const field = `images[${i}]`;
      if (isPlainObject(entry)) {
        const extra = Object.keys(entry).filter((k) => !['part', 'isPrimary'].includes(k));
        extra.forEach((k) => fail(`${field}.${k}`, 'unknown field'));
        if (entry.isPrimary !== undefined && typeof entry.isPrimary !== 'boolean') {
          fail(`${field}.isPrimary`, 'must be true or false');
        }
      }
      const file = take(entry, field);
      if (!file) return;
      if (!model.PHOTO_TYPES.includes(file.mimeType)) {
        fail(field, `a photo must be one of: ${model.PHOTO_TYPES.join(', ')}`);
      } else if (file.data.length > model.PHOTO_MAX_BYTES) {
        fail(field, `a photo can be at most ${model.PHOTO_MAX_BYTES / (1024 * 1024)} MB`);
      } else {
        images.push({ file, isPrimary: entry.isPrimary === true });
      }
    });
    const primaries = images.filter((img) => img.isPrimary).length;
    if (primaries > 1) fail('images', 'only one photo can be the primary photo');
    // The first photo is primary unless another was chosen, as in the form.
    if (images.length && primaries === 0) images[0].isPrimary = true;
  }

  const media = [];
  const rawMedia = request.mediaInstructions ?? [];
  if (!Array.isArray(rawMedia)) fail('mediaInstructions', 'must be an array');
  else {
    rawMedia.forEach((entry, i) => {
      const field = `mediaInstructions[${i}]`;
      if (isPlainObject(entry)) {
        const extra = Object.keys(entry).filter((k) => !['part', 'caption'].includes(k));
        extra.forEach((k) => fail(`${field}.${k}`, 'unknown field'));
        if (
          entry.caption !== undefined &&
          entry.caption !== null &&
          typeof entry.caption !== 'string'
        ) {
          fail(`${field}.caption`, 'must be a string');
        }
      }
      const file = take(entry, field);
      if (!file) return;
      const type = model.mediaTypeOf(file.mimeType);
      if (!type) fail(field, `step media must be one of: ${model.MEDIA_TYPES.join(', ')}`);
      else if (file.data.length > model.MEDIA_MAX_BYTES) {
        fail(field, `a file can be at most ${model.MEDIA_MAX_BYTES / (1024 * 1024)} MB`);
      } else {
        media.push({
          file,
          type,
          caption: typeof entry.caption === 'string' ? entry.caption.trim() : '',
        });
      }
    });
  }

  for (const name of files.keys()) {
    if (!used.has(name)) fail(name, 'a file part that no entry refers to');
  }
  if (problems.length) throw invalid('invalid-files', 'The files have problems.', problems);
  return { images, media };
}

module.exports = { parseMultipart, sniffType, typesAgree, planUploads, MAX_MULTIPART_BYTES };
