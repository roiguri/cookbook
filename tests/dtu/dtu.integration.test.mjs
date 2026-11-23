/**
 * End-to-end integration tests for the Cookbook Digital Twin Universe (DTU).
 * Run via `npm run test:dtu` (starts all 4 twins + Firebase Emulators).
 */
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { CATEGORY_IDS } from '@cookbook/core/recipe-model';
import { deviceIdForToken } from '@cookbook/core/push-devices';
import { DTU_CONFIG, dtuUrls } from '../../factory/dtu/config.mjs';
import { SAMPLE_PNG_BUFFER } from '../../factory/dtu/seed-server/fixtures.mjs';

const URLS = dtuUrls(DTU_CONFIG);
const PROJECT = DTU_CONFIG.projectId;
const BUCKET = DTU_CONFIG.bucket;

async function jsonPost(url, body = undefined) {
  const res = await fetch(url, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${url} failed (${res.status}): ${text}`);
  return text ? JSON.parse(text) : {};
}

async function jsonGet(url) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${url} failed (${res.status}): ${text}`);
  return JSON.parse(text);
}

async function pollUntil(predicate, timeoutMs = 10000, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`pollUntil timed out after ${timeoutMs}ms`);
}

let appCounter = 0;
async function signInAs(email, password) {
  const app = initializeApp(
    { apiKey: 'demo-key', projectId: PROJECT },
    `dtu-client-${++appCounter}`,
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, URLS.auth, { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, DTU_CONFIG.host, DTU_CONFIG.ports.firestore);
  const fns = getFunctions(app);
  connectFunctionsEmulator(fns, DTU_CONFIG.host, DTU_CONFIG.ports.functions);

  const cred = await signInWithEmailAndPassword(auth, email, password);
  return {
    app,
    uid: cred.user.uid,
    db,
    call: (name, data) => httpsCallable(fns, name)(data).then((r) => r.data),
    close: () => deleteApp(app),
  };
}

describe('Cookbook Digital Twin Universe (DTU)', () => {
  let seedInfo;

  beforeEach(async () => {
    seedInfo = await jsonPost(`${URLS.seed}/seed/baseline`);
  });

  test('all 4 twin health endpoints respond healthy', async () => {
    const [seed, gemini, fcm, resize] = await Promise.all([
      jsonGet(`${URLS.seed}/health`),
      jsonGet(`${URLS.gemini}/health`),
      jsonGet(`${URLS.fcm}/health`),
      jsonGet(`${URLS.resize}/health`),
    ]);
    expect(seed).toMatchObject({ ok: true, service: 'seed-server', lastProfile: 'baseline' });
    expect(gemini).toMatchObject({ ok: true, service: 'gemini-twin' });
    expect(fcm).toMatchObject({ ok: true, service: 'fcm-twin' });
    expect(resize).toMatchObject({ ok: true, service: 'resize-twin' });
  });

  test('seed-server populates all 10 categories, subcollections, Storage files, and snapshot diffs cleanly', async () => {
    const snap = await jsonGet(`${URLS.seed}/snapshot`);

    expect(snap.authUsers.map((u) => u.uid)).toEqual([
      'dtu-approved-1',
      'dtu-approved-2',
      'dtu-manager-1',
      'dtu-user-1',
    ]);

    for (const catId of CATEGORY_IDS) {
      expect(snap.firestore[`recipes/dtu-pub-${catId}`]).toBeDefined();
      expect(snap.firestore[`recipes/dtu-pub-${catId}`].visibility).toBe('published');
    }

    // Subcollections captured in snapshot
    expect(snap.firestore['recipes/dtu-priv-shared/shares/dtu-approved-2']).toMatchObject({
      authorId: 'dtu-approved-1',
      recipientUid: 'dtu-approved-2',
    });
    const managerDeviceKeys = Object.keys(snap.firestore).filter((k) =>
      k.startsWith('users/dtu-manager-1/devices/'),
    );
    expect(managerDeviceKeys).toHaveLength(3);

    // Grandma's cookbook (`cookbook/recipes`) & active meal (`lastUpdated`) & failed URL queue
    expect(Object.keys(snap.firestore['cookbook/recipes'].categories)).toHaveLength(3);
    expect(snap.firestore['cookbook/recipes'].recipes['עוגת דבש של פעם']).toBe(3);
    expect(snap.firestore['active_meals/dtu-approved-1'].recipeIds).toHaveLength(2);
    expect(snap.firestore['active_meals/dtu-approved-1'].lastUpdated).toBeDefined();
    expect(snap.firestore['failed_url_extractions/dtu-failed-url-1']).toBeDefined();

    // Empty profile resets cleanly
    await jsonPost(`${URLS.seed}/seed/empty`);
    const emptySnap = await jsonGet(`${URLS.seed}/snapshot`);
    expect(emptySnap.authUsers).toHaveLength(4);
    expect(Object.keys(emptySnap.firestore).filter((k) => k.startsWith('recipes/'))).toHaveLength(
      0,
    );
    expect(emptySnap.storage).toHaveLength(0);
  });

  test('resize-twin generates real _400x400.webp and _1080x1080.webp variants in Storage Emulator', async () => {
    const snap = await jsonGet(`${URLS.seed}/snapshot`);
    const names = snap.storage.map((o) => o.name);

    const expected400 = 'recipes/dtu-pub-desserts/images/img-seed-5_400x400.webp';
    const expected1080 = 'recipes/dtu-pub-desserts/images/img-seed-5_1080x1080.webp';
    expect(names).toContain(expected400);
    expect(names).toContain(expected1080);

    // Verify downloaded WebP bytes carry valid RIFF....WEBP header
    const res = await fetch(
      `${URLS.storage}/v0/b/${encodeURIComponent(BUCKET)}/o/${encodeURIComponent(expected400)}?alt=media`,
      { headers: { Authorization: 'Bearer owner' } },
    );
    expect(res.ok).toBe(true);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(buf.subarray(8, 12).toString('ascii')).toBe('WEBP');
  });

  test('gemini-twin serves all 4 real Gemini callables ($0 spend) and fault injection logs failed URLs', async () => {
    const approved = await signInAs(
      seedInfo.users.approved.email,
      seedInfo.users.approved.password,
    );
    const manager = await signInAs(seedInfo.users.manager.email, seedInfo.users.manager.password);

    try {
      // 1. Image extraction
      const fromImage = await approved.call('extractRecipeFromImage', {
        images: [{ base64: SAMPLE_PNG_BUFFER.toString('base64'), mimeType: 'image/png' }],
      });
      expect(fromImage.name).toBe('עוגת שוקולד ביתית מתמונה');
      expect(fromImage.category).toBe('desserts');

      // 2. URL extraction
      const fromUrl = await approved.call('extractRecipeFromUrl', {
        url: 'https://recipes.example.test/shakshuka',
      });
      expect(fromUrl.name).toBe('שקשוקה משפחתית מקישור');

      // 3. YouTube video extraction (sectioned recipe)
      const fromVideo = await approved.call('extractRecipeFromVideo', {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      });
      expect(fromVideo.name).toBe("פוקאצ'ה אוורירית מסרטון");
      expect(fromVideo.ingredientSections).toHaveLength(2);
      expect(fromVideo.stages).toHaveLength(2);

      // 4. Manager food-image enhancement (auto-selects unset axes + generates PNG)
      const enhanced = await manager.call('enhanceFoodImage', {
        image: { base64: SAMPLE_PNG_BUFFER.toString('base64'), mimeType: 'image/png' },
        parameters: { lighting: 'moody' },
        instruction: 'רקע כהה יותר',
      });
      expect(enhanced.mimeType).toBe('image/png');
      expect(Buffer.from(enhanced.base64, 'base64').subarray(1, 4).toString('ascii')).toBe('PNG');
      expect(enhanced.selectedParameters).toEqual({
        lighting: 'moody',
        angle: 'hero',
        surface: 'wood',
        styling: 'editorial',
      });

      // 5. Fault injection: empty Gemini response triggers real failure & failed_url_extractions log
      const faultUrl = 'https://recipes.example.test/broken?dtu_fault=empty';
      await expect(approved.call('extractRecipeFromUrl', { url: faultUrl })).rejects.toThrow();

      const snap = await jsonGet(`${URLS.seed}/snapshot`);
      const loggedFailure = Object.entries(snap.firestore).find(
        ([k, v]) => k.startsWith('failed_url_extractions/') && v.url === faultUrl,
      );
      expect(loggedFailure).toBeDefined();
    } finally {
      await approved.close();
      await manager.close();
    }
  });

  test('fcm-twin captures per-platform push batches from live onRecipeSubmitted trigger and prunes dead tokens', async () => {
    // Mark manager's iOS token as permanently invalid so pruning is verified end-to-end
    const deadIosToken = 'dtu-fcm-ios-manager-1';
    const deadIosDocPath = `users/dtu-manager-1/devices/${deviceIdForToken(deadIosToken)}`;
    await jsonPost(`${URLS.fcm}/invalid-tokens`, { tokens: [deadIosToken] });

    const approved = await signInAs(
      seedInfo.users.approved.email,
      seedInfo.users.approved.password,
    );
    try {
      const recipeId = 'dtu-live-push-test';
      const batch = writeBatch(approved.db);
      batch.set(doc(approved.db, 'recipes', recipeId), {
        name: 'בורקס גבינה חם',
        category: 'breads-pastries',
        difficulty: 'קלה',
        prepTime: 20,
        servings: 8,
        ingredients: [{ item: 'בצק עלים', amount: 1, unit: 'חבילה' }],
        instructions: ['ממלאים ואופים.'],
        authorId: approved.uid,
        visibility: 'private',
        stage: 'tested',
        creationTime: serverTimestamp(),
      });
      batch.set(doc(approved.db, 'recipe_submissions', recipeId), {
        recipeId,
        authorId: approved.uid,
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
        createdAt: serverTimestamp(),
      });
      await batch.commit();

      // Wait for real Firestore trigger onRecipeSubmitted -> notifications.js -> fcm-twin
      const messages = await pollUntil(async () => {
        const { messages: list } = await jsonGet(`${URLS.fcm}/messages?recipeId=${recipeId}`);
        return list.length >= 3 ? list : null;
      }, 15000);

      const byPlatform = Object.fromEntries(messages.map((m) => [m.platform, m]));
      expect(Object.keys(byPlatform).sort()).toEqual(['android', 'ios', 'web']);

      // Web is data-only; Android & iOS include native notification + platform config
      expect(byPlatform.web.message.notification).toBeUndefined();
      expect(byPlatform.web.message.data.body).toBe('בורקס גבינה חם');
      expect(byPlatform.android.message.notification.body).toBe('בורקס גבינה חם');
      expect(byPlatform.android.message.android.priority).toBe('high');
      expect(byPlatform.ios.message.notification.body).toBe('בורקס גבינה חם');
      expect(byPlatform.ios.message.apns.headers['apns-collapse-id']).toBe('recipe-approval');

      // Dead iOS token doc should be pruned automatically from Firestore
      await pollUntil(async () => {
        const snap = await jsonGet(`${URLS.seed}/snapshot`);
        return !(deadIosDocPath in snap.firestore);
      }, 10000);
    } finally {
      await approved.close();
    }
  });
});
