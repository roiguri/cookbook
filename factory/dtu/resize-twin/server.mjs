/**
 * Storage Image-Resize Digital Twin (:9203)
 *
 * Emulates Firebase's "Resize Images" extension against the local Storage
 * Emulator (:9199): detects uploaded recipe photos under
 *   - recipes/{recipeId}/images/{file}
 *   - users/{uid}/recipes/{recipeId}/images/{file}
 * and writes real `_400x400.webp` and `_1080x1080.webp` WebP variants right
 * alongside them.
 *
 * Uses Python Pillow (webp-enabled) when available, with a pure-Node minimal
 * valid WebP fallback so it works cleanly on any Linux/macOS runner.
 */
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DTU_CONFIG, readJsonBody, sendJson } from '../config.mjs';

export const RESIZE_SIZES = [400, 1080];

// Valid 1x1 lossless WebP (VP8L) fallback buffer if Pillow is unavailable
const FALLBACK_WEBP_BUFFER = Buffer.from(
  'UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
  'base64',
);

const PILLOW_RESIZE_SCRIPT = `
import io, sys
from PIL import Image
size = int(sys.argv[1])
raw = sys.stdin.buffer.read()
img = Image.open(io.BytesIO(raw)).convert("RGBA")
img.thumbnail((size, size))
out = io.BytesIO()
img.save(out, format="WEBP", quality=80)
sys.stdout.buffer.write(out.getvalue())
`;

function detectPillowWebp() {
  const probe = spawnSync(
    'python3',
    ['-c', 'from PIL import features; import sys; sys.exit(0 if features.check("webp") else 1)'],
    { timeout: 5000 },
  );
  return !probe.error && probe.status === 0;
}

const HAS_PILLOW_WEBP = detectPillowWebp();

/**
 * Resize an image buffer to a max bounding box (`size` x `size`) as WebP.
 * @param {Buffer} inputBuffer
 * @param {number} size
 * @returns {Buffer}
 */
export function resizeToWebpBuffer(inputBuffer, size) {
  if (HAS_PILLOW_WEBP) {
    const res = spawnSync('python3', ['-c', PILLOW_RESIZE_SCRIPT, String(size)], {
      input: inputBuffer,
      timeout: 10000,
      maxBuffer: 20 * 1024 * 1024,
    });
    if (!res.error && res.status === 0 && res.stdout && res.stdout.length > 12) {
      return Buffer.from(res.stdout);
    }
  }
  return FALLBACK_WEBP_BUFFER;
}

/**
 * Whether a Storage object path is an original recipe photo that needs resized variants.
 * @param {string} objectPath
 * @returns {boolean}
 */
export function isResizableRecipePhoto(objectPath) {
  if (typeof objectPath !== 'string') return false;
  if (/_(400x400|1080x1080)\.webp$/i.test(objectPath)) return false;
  if (/_original\.[^./]+$/i.test(objectPath)) return false;
  const isRecipeImagePath =
    /^recipes\/[^/]+\/images\/[^/]+$/.test(objectPath) ||
    /^users\/[^/]+\/recipes\/[^/]+\/images\/[^/]+$/.test(objectPath);
  if (!isRecipeImagePath) return false;
  return /\.(jpe?g|png|webp)$/i.test(objectPath);
}

/**
 * Compute resized variant paths matching Firebase Resize Images extension naming.
 * @param {string} objectPath
 * @returns {Array<{ size: number, path: string }>}
 */
export function variantPathsFor(objectPath) {
  const withoutExt = objectPath.replace(/\.[^./]+$/, '');
  return RESIZE_SIZES.map((size) => ({
    size,
    path: `${withoutExt}_${size}x${size}.webp`,
  }));
}

export function createResizeTwinServer({
  storageBaseUrl = `http://${DTU_CONFIG.host}:${DTU_CONFIG.ports.storage}`,
  bucket = DTU_CONFIG.bucket,
  pollIntervalMs = 500,
} = {}) {
  const processed = new Set();
  const ownerHeaders = { Authorization: 'Bearer owner' };

  async function listObjects() {
    const url = `${storageBaseUrl}/v0/b/${encodeURIComponent(bucket)}/o`;
    const res = await fetch(url, { headers: ownerHeaders });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json.items) ? json.items : [];
  }

  async function downloadObject(objectPath) {
    const url = `${storageBaseUrl}/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectPath)}?alt=media`;
    const res = await fetch(url, { headers: ownerHeaders });
    if (!res.ok) throw new Error(`Failed to download ${objectPath}: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async function fetchObjectMetadata(objectPath) {
    try {
      const url = `${storageBaseUrl}/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectPath)}`;
      const res = await fetch(url, { headers: ownerHeaders });
      if (!res.ok) return {};
      const json = await res.json();
      return json?.metadata && typeof json.metadata === 'object' ? json.metadata : {};
    } catch {
      return {};
    }
  }

  async function uploadWebp(objectPath, buffer, sourceMetadata = {}) {
    const url = `${storageBaseUrl}/v0/b/${encodeURIComponent(bucket)}/o?name=${encodeURIComponent(objectPath)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...ownerHeaders,
        'Content-Type': 'image/webp',
      },
      body: buffer,
    });
    if (!res.ok) throw new Error(`Failed to upload ${objectPath}: HTTP ${res.status}`);

    const patchUrl = `${storageBaseUrl}/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectPath)}`;
    await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        ...ownerHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contentType: 'image/webp',
        metadata: sourceMetadata,
      }),
    }).catch(() => {});
  }

  async function resizeOne(objectPath) {
    const [original, sourceMetadata] = await Promise.all([
      downloadObject(objectPath),
      fetchObjectMetadata(objectPath),
    ]);
    const variants = variantPathsFor(objectPath);
    for (const v of variants) {
      const webpBuf = resizeToWebpBuffer(original, v.size);
      await uploadWebp(v.path, webpBuf, sourceMetadata);
    }
    processed.add(objectPath);
    return variants.map((v) => v.path);
  }

  let scanning = false;
  async function scanAndResize() {
    if (scanning) return { generated: [] };
    scanning = true;
    const generated = [];
    try {
      const items = await listObjects();
      const existingNames = new Set(items.map((item) => item.name));
      for (const item of items) {
        const name = item.name;
        if (!isResizableRecipePhoto(name)) continue;
        const needed = variantPathsFor(name).some((v) => !existingNames.has(v.path));
        if (!needed) {
          processed.add(name);
          continue;
        }
        const created = await resizeOne(name);
        generated.push(...created);
      }
    } catch {
      // silent during emulator startup/teardown
    } finally {
      scanning = false;
    }
    return { generated };
  }

  const timer = pollIntervalMs > 0 ? setInterval(scanAndResize, pollIntervalMs) : null;
  if (timer && typeof timer.unref === 'function') timer.unref();

  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'GET' && urlObj.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        service: 'resize-twin',
        processedCount: processed.size,
        mode: HAS_PILLOW_WEBP ? 'pillow' : 'fallback',
      });
    }

    if (req.method === 'POST' && urlObj.pathname === '/reset') {
      processed.clear();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && urlObj.pathname === '/scan') {
      const result = await scanAndResize();
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === 'POST' && urlObj.pathname === '/resize') {
      try {
        const body = await readJsonBody(req);
        if (!body.path) return sendJson(res, 400, { error: 'path is required' });
        const generated = await resizeOne(body.path);
        return sendJson(res, 200, { ok: true, generated });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    return sendJson(res, 404, { error: 'Not found' });
  });

  server.on('close', () => {
    if (timer) clearInterval(timer);
  });

  return { server, processed, scanAndResize };
}

export function startResizeTwin({
  host = DTU_CONFIG.host,
  port = DTU_CONFIG.ports.resize,
  storageBaseUrl,
  bucket,
  pollIntervalMs,
} = {}) {
  const { server, processed, scanAndResize } = createResizeTwinServer({
    storageBaseUrl,
    bucket,
    pollIntervalMs,
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({
        server,
        processed,
        scanAndResize,
        port: addr.port,
        url: `http://${host}:${addr.port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  startResizeTwin().then(({ url }) => {
    console.log(`[resize-twin] listening on ${url}`);
  });
}
