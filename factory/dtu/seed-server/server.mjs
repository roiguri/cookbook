/**
 * Deterministic Seed, Reset & Snapshot Controller (:9200)
 *
 * Talks directly to the local Firebase Auth (:9099), Firestore (:8080), and
 * Storage (:9199) Emulators via REST APIs with admin bypass (`Bearer owner`),
 * plus resets sibling twins (`gemini-twin`, `fcm-twin`, `resize-twin`).
 *
 * Endpoints:
 *   - GET  /health           -> readiness & last seeded profile
 *   - POST /reset            -> wipe Auth, Firestore, Storage emulators & sibling twins
 *   - POST /seed/:profile    -> reset (unless ?keep=true) and seed `baseline` | `empty` | `all`
 *   - GET  /snapshot         -> deterministic JSON snapshot of Auth, Firestore (incl. subcollections), and Storage
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { DTU_CONFIG, dtuUrls, sendJson } from '../config.mjs';
import { buildSeedDataset } from './fixtures.mjs';

const OWNER_HEADERS = {
  Authorization: 'Bearer owner',
  'Content-Type': 'application/json',
};

// --- Firestore REST value codecs --------------------------------------------

export function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

export function fromFirestoreValue(val) {
  if (!val || typeof val !== 'object') return null;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('stringValue' in val) return val.stringValue;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map(fromFirestoreValue);
  }
  if ('mapValue' in val) {
    const out = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      out[k] = fromFirestoreValue(v);
    }
    return out;
  }
  return val;
}

function toFirestoreDocument(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined) continue;
    fields[k] = toFirestoreValue(v);
  }
  return { fields };
}

function fromFirestoreDocument(docObj) {
  const out = {};
  for (const [k, v] of Object.entries(docObj.fields || {})) {
    out[k] = fromFirestoreValue(v);
  }
  return out;
}

// --- Seed Server ------------------------------------------------------------

export function createSeedServer({ config = DTU_CONFIG } = {}) {
  const urls = dtuUrls(config);
  const projectId = config.projectId;
  const bucket = config.bucket;
  const firestoreRoot = `${urls.firestore}/v1/projects/${projectId}/databases/(default)/documents`;

  const state = {
    lastProfile: null,
    lastSeededAt: null,
  };

  async function clearAuth() {
    const res = await fetch(`${urls.auth}/emulator/v1/projects/${projectId}/accounts`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`Auth clear failed: HTTP ${res.status}`);
  }

  async function clearFirestore() {
    const res = await fetch(
      `${urls.firestore}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
      { method: 'DELETE' },
    );
    if (!res.ok) throw new Error(`Firestore clear failed: HTTP ${res.status}`);
  }

  async function clearStorage() {
    const listUrl = `${urls.storage}/v0/b/${encodeURIComponent(bucket)}/o`;
    const listRes = await fetch(listUrl, { headers: { Authorization: 'Bearer owner' } });
    if (!listRes.ok) return;
    const json = await listRes.json();
    const items = Array.isArray(json.items) ? json.items : [];
    await Promise.all(
      items.map((item) =>
        fetch(
          `${urls.storage}/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(item.name)}`,
          {
            method: 'DELETE',
            headers: { Authorization: 'Bearer owner' },
          },
        ),
      ),
    );
  }

  async function resetSiblingTwins() {
    const twinUrls = [urls.gemini, urls.fcm, urls.resize];
    await Promise.all(
      twinUrls.map((base) =>
        fetch(`${base}/reset`, { method: 'POST' }).catch(() => {
          // silent: sibling twin may not be running in isolated unit tests
        }),
      ),
    );
  }

  async function resetAll() {
    await Promise.all([clearAuth(), clearFirestore(), clearStorage(), resetSiblingTwins()]);
    state.lastProfile = null;
  }

  async function seedAuthUser(user) {
    // Sign up via Identity Toolkit emulator with deterministic localId
    const res = await fetch(
      `${urls.auth}/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts`,
      {
        method: 'POST',
        headers: OWNER_HEADERS,
        body: JSON.stringify({
          localId: user.uid,
          email: user.email,
          password: user.password,
          displayName: user.fullName,
          emailVerified: true,
        }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to seed auth user ${user.email}: HTTP ${res.status} ${text}`);
    }
  }

  async function writeFirestoreDoc(docPath, data) {
    const res = await fetch(`${firestoreRoot}/${docPath}`, {
      method: 'PATCH',
      headers: OWNER_HEADERS,
      body: JSON.stringify(toFirestoreDocument(data)),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to write Firestore doc ${docPath}: HTTP ${res.status} ${text}`);
    }
  }

  async function uploadStorageFile(fileSpec) {
    const uploadUrl = `${urls.storage}/v0/b/${encodeURIComponent(bucket)}/o?name=${encodeURIComponent(fileSpec.path)}`;
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer owner',
        'Content-Type': fileSpec.contentType,
      },
      body: fileSpec.buffer,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to upload Storage file ${fileSpec.path}: HTTP ${res.status} ${text}`);
    }
    if (fileSpec.metadata && Object.keys(fileSpec.metadata).length > 0) {
      const patchUrl = `${urls.storage}/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(fileSpec.path)}`;
      const patchRes = await fetch(patchUrl, {
        method: 'PATCH',
        headers: OWNER_HEADERS,
        body: JSON.stringify({
          contentType: fileSpec.contentType,
          metadata: fileSpec.metadata,
        }),
      });
      if (!patchRes.ok) {
        const text = await patchRes.text();
        throw new Error(
          `Failed to patch Storage metadata ${fileSpec.path}: HTTP ${patchRes.status} ${text}`,
        );
      }
    }
  }

  async function seedProfile(profile = 'baseline', { keep = false } = {}) {
    if (!keep) await resetAll();
    const dataset = buildSeedDataset(profile);

    for (const user of dataset.users) {
      await seedAuthUser(user);
    }

    await Promise.all(
      Object.entries(dataset.docs).map(([docPath, data]) => writeFirestoreDoc(docPath, data)),
    );

    await Promise.all(dataset.files.map((fileSpec) => uploadStorageFile(fileSpec)));

    // Trigger resize-twin synchronously so seeded photos have WebP variants immediately
    await fetch(`${urls.resize}/scan`, { method: 'POST' }).catch(() => {
      // silent if resize-twin is not running
    });

    // If this profile seeded a pending submission, wait briefly for the background
    // onRecipeSubmitted trigger to drain into fcm-twin, then clear fcm-twin so
    // downstream scenarios start with a quiescent emulator and empty push inbox.
    if (dataset.docs['recipe_submissions/dtu-sub-pending']) {
      const drainDeadline = Date.now() + 4000;
      while (Date.now() < drainDeadline) {
        try {
          const r = await fetch(`${urls.fcm}/messages?recipeId=dtu-sub-pending`);
          if (!r.ok) break;
          const j = await r.json();
          if (Array.isArray(j.messages) && j.messages.length >= 3) break;
        } catch {
          break;
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      await fetch(`${urls.fcm}/reset`, { method: 'POST' }).catch(() => {});
    }

    state.lastProfile = profile;
    state.lastSeededAt = new Date().toISOString();

    return {
      ok: true,
      profile,
      seededAt: state.lastSeededAt,
      users: Object.fromEntries(
        dataset.users.map((u) => [
          u.key,
          { uid: u.uid, email: u.email, password: u.password, role: u.role },
        ]),
      ),
      recipes: dataset.recipes,
      docCount: Object.keys(dataset.docs).length,
      fileCount: dataset.files.length,
    };
  }

  // Known collections & subcollections to capture in deterministic snapshots
  const ROOT_COLLECTIONS = [
    'users',
    'recipes',
    'recipe_submissions',
    'recipe_edit_suggestions',
    'active_meals',
    'cookbook',
    'failed_url_extractions',
    'api_tokens',
  ];

  async function listCollectionDocs(collectionPath) {
    const res = await fetch(`${firestoreRoot}/${collectionPath}?pageSize=500`, {
      headers: { Authorization: 'Bearer owner' },
    });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json.documents) ? json.documents : [];
  }

  async function takeSnapshot() {
    // 1. Auth users
    const authRes = await fetch(
      `${urls.auth}/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:query`,
      {
        method: 'POST',
        headers: OWNER_HEADERS,
        body: JSON.stringify({ returnUserInfo: true }),
      },
    );
    const authJson = authRes.ok ? await authRes.json() : {};
    const authUsers = (authJson.userInfo || [])
      .map((u) => ({
        uid: u.localId,
        email: u.email,
        displayName: u.displayName || '',
        disabled: Boolean(u.disabled),
      }))
      .sort((a, b) => a.uid.localeCompare(b.uid));

    // 2. Firestore root collections + known subcollections (`users/*/devices`, `recipes/*/shares`)
    const firestoreDocs = {};
    const prefix = `projects/${projectId}/databases/(default)/documents/`;

    for (const col of ROOT_COLLECTIONS) {
      const docs = await listCollectionDocs(col);
      for (const docObj of docs) {
        const relPath = docObj.name.startsWith(prefix)
          ? docObj.name.slice(prefix.length)
          : docObj.name;
        firestoreDocs[relPath] = fromFirestoreDocument(docObj);

        if (col === 'users') {
          const devDocs = await listCollectionDocs(`${relPath}/devices`);
          for (const d of devDocs) {
            const devPath = d.name.startsWith(prefix) ? d.name.slice(prefix.length) : d.name;
            firestoreDocs[devPath] = fromFirestoreDocument(d);
          }
        } else if (col === 'recipes') {
          const shareDocs = await listCollectionDocs(`${relPath}/shares`);
          for (const s of shareDocs) {
            const sharePath = s.name.startsWith(prefix) ? s.name.slice(prefix.length) : s.name;
            firestoreDocs[sharePath] = fromFirestoreDocument(s);
          }
        }
      }
    }

    const sortedFirestore = Object.fromEntries(
      Object.keys(firestoreDocs)
        .sort()
        .map((k) => [k, firestoreDocs[k]]),
    );

    // 3. Storage objects (list endpoint returns only {name, bucket}; fetch each object's metadata)
    const storageRes = await fetch(`${urls.storage}/v0/b/${encodeURIComponent(bucket)}/o`, {
      headers: { Authorization: 'Bearer owner' },
    });
    const storageJson = storageRes.ok ? await storageRes.json() : {};
    const listedItems = Array.isArray(storageJson.items) ? storageJson.items : [];
    const storage = (
      await Promise.all(
        listedItems.map(async (item) => {
          try {
            const metaRes = await fetch(
              `${urls.storage}/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(item.name)}`,
              { headers: { Authorization: 'Bearer owner' } },
            );
            const meta = metaRes.ok ? await metaRes.json() : item;
            return {
              name: meta.name || item.name,
              contentType: meta.contentType || '',
              size: Number(meta.size || 0),
              metadata: meta.metadata || {},
            };
          } catch {
            return {
              name: item.name,
              contentType: item.contentType || '',
              size: Number(item.size || 0),
              metadata: item.metadata || {},
            };
          }
        }),
      )
    ).sort((a, b) => a.name.localeCompare(b.name));

    return {
      capturedAt: new Date().toISOString(),
      projectId,
      authUsers,
      firestore: sortedFirestore,
      storage,
    };
  }

  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'GET' && urlObj.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        service: 'seed-server',
        projectId,
        lastProfile: state.lastProfile,
        lastSeededAt: state.lastSeededAt,
      });
    }

    if (req.method === 'POST' && urlObj.pathname === '/reset') {
      try {
        await resetAll();
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (req.method === 'POST' && urlObj.pathname.startsWith('/seed/')) {
      const profile = urlObj.pathname.slice('/seed/'.length) || 'baseline';
      const keep = urlObj.searchParams.get('keep') === 'true';
      try {
        const result = await seedProfile(profile, { keep });
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (req.method === 'GET' && urlObj.pathname === '/snapshot') {
      try {
        const snapshot = await takeSnapshot();
        return sendJson(res, 200, snapshot);
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    return sendJson(res, 404, { error: 'Not found' });
  });

  return { server, state, resetAll, seedProfile, takeSnapshot };
}

export function startSeedServer({
  config = DTU_CONFIG,
  host = config.host,
  port = config.ports.seed,
} = {}) {
  const { server, state, resetAll, seedProfile, takeSnapshot } = createSeedServer({ config });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({
        server,
        state,
        resetAll,
        seedProfile,
        takeSnapshot,
        port: addr.port,
        url: `http://${host}:${addr.port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  startSeedServer().then(({ url }) => {
    console.log(`[seed-server] listening on ${url}`);
  });
}
