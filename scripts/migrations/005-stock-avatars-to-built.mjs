#!/usr/bin/env node
// =============================================================================
// Retire the stock avatars (docs/architecture/avatars.md → "Retiring the stock avatars")
//
// Users whose avatar is one of the six stock chefs (`users/{uid}.avatarUrl` points
// at `Avatars/<file>.svg`) get the look-alike built chef below instead: the same
// PNG and config the avatar builder would save — `user-avatars/{uid}.png` (tagged
// with the user as uploader) and `avatarUrl` + `avatarConfig` on their profile.
// They open the builder already on that chef and can adjust it.
//
// Only stock avatars are touched; built avatars, initials and Google photos are
// left alone. Safe to re-run: converted users are no longer on a stock avatar.
// The dry run reports how many users have each stock avatar and changes nothing.
//
// Usage (repo root; gcloud application-default credentials):
//   npm i --no-save firebase-admin@12          # once, like the other migrations
//   node scripts/migrations/005-stock-avatars-to-built.mjs --project staging            # dry run
//   node scripts/migrations/005-stock-avatars-to-built.mjs --project staging --apply
//   node scripts/migrations/005-stock-avatars-to-built.mjs --project production --apply
// `--project` takes a .firebaserc alias; there is no default. `--project emulator`
// runs against `npm run dev:emulators` (demo-cookbook) for a local rehearsal.
// =============================================================================
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { Resvg } from '@resvg/resvg-js';
import { normalizeAvatarConfig, renderAvatarSvg } from '../../src/js/utils/avatar/chef-avatar.js';

/** Stock avatar file → look-alike built chef (approved 2026-10-15). */
const LOOKALIKES = {
  '01-boy.svg': {
    parts: { hair: 'shortRound', eyes: 'happy', mouth: 'smile', hat: 'toque', outfit: 'jacket' },
    colors: { skin: 'light', hair: 'brown', outfit: 'green', background: 'cream' },
  },
  '02-man.svg': {
    parts: {
      hair: 'theCaesar',
      brows: 'flatNatural',
      mouth: 'twinkle',
      facialHair: 'moustacheFancy',
      hat: 'toque',
      outfit: 'apron',
    },
    colors: { skin: 'light', hair: 'darkBrown', outfit: 'burgundy', background: 'cream' },
  },
  '03-man2.svg': {
    parts: {
      hair: 'theCaesar',
      brows: 'flatNatural',
      mouth: 'twinkle',
      facialHair: 'moustacheFancy',
      hat: 'toque',
      outfit: 'apron',
    },
    colors: { skin: 'brown', hair: 'black', outfit: 'burgundy', background: 'cream' },
  },
  '04-girl.svg': {
    parts: { hair: 'bob', eyes: 'happy', mouth: 'smile', hat: 'toque', outfit: 'jacket' },
    colors: { skin: 'light', hair: 'auburn', outfit: 'green', background: 'cream' },
  },
  '04-woman.svg': {
    parts: { hair: 'straight01', mouth: 'twinkle', hat: 'toque', outfit: 'apron' },
    colors: { skin: 'light', hair: 'black', outfit: 'burgundy', background: 'cream' },
  },
  '06-woman2.svg': {
    parts: { hair: 'straight01', mouth: 'twinkle', hat: 'toque', outfit: 'apron' },
    colors: { skin: 'dark', hair: 'black', outfit: 'burgundy', background: 'cream' },
  },
};

const args = process.argv.slice(2);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  const value = i >= 0 ? args[i + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
};
const alias = valueOf('--project');
const APPLY = args.includes('--apply');
if (!alias) {
  console.error(
    'Usage: 005-stock-avatars-to-built.mjs --project <staging|production|emulator> [--apply]',
  );
  process.exit(2);
}

let projectId;
if (alias === 'emulator') {
  projectId = 'demo-cookbook';
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= '127.0.0.1:9199';
} else {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  projectId = JSON.parse(readFileSync(join(root, '.firebaserc'), 'utf8')).projects[alias];
  if (!projectId) {
    console.error(`Unknown .firebaserc alias: ${alias}`);
    process.exit(2);
  }
}

initializeApp({ projectId });
const db = getFirestore();

async function findBucket() {
  // The emulator can't check buckets; its bucket is the one in .env.emulators.
  if (alias === 'emulator') return getStorage().bucket(`${projectId}.appspot.com`);
  for (const name of [`${projectId}.firebasestorage.app`, `${projectId}.appspot.com`]) {
    const bucket = getStorage().bucket(name);
    const [exists] = await bucket.exists().catch(() => [false]);
    if (exists) return bucket;
  }
  throw new Error(`No default Storage bucket found for ${projectId}`);
}

/** The stock file a user's avatarUrl points at (e.g. '02-man.svg'), or null. */
function stockFile(avatarUrl) {
  if (typeof avatarUrl !== 'string') return null;
  const match = avatarUrl.match(/\/o\/Avatars%2F([^?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** A download URL like the client SDK's, versioned like UserService.uploadAvatarImage. */
function downloadUrl(bucket, path, token) {
  const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST
    ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}`
    : 'https://firebasestorage.googleapis.com';
  return `${host}/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}&v=${Date.now()}`;
}

async function main() {
  console.log(
    `==> project: ${alias} (${projectId})${APPLY ? '' : ' — dry run, pass --apply to write'}`,
  );
  const users = await db.collection('users').get();
  const onStock = users.docs
    .map((doc) => ({ uid: doc.id, file: stockFile(doc.data().avatarUrl) }))
    .filter((u) => u.file);

  const counts = {};
  for (const { file } of onStock) counts[file] = (counts[file] || 0) + 1;
  console.log(`==> users: ${users.size} | on a stock avatar: ${onStock.length}`);
  for (const [file, n] of Object.entries(counts)) {
    console.log(
      `    ${file.padEnd(14)} ${n}${LOOKALIKES[file] ? '' : '  (no look-alike — skipped)'}`,
    );
  }
  if (!APPLY || onStock.length === 0) return;

  const bucket = await findBucket();
  let converted = 0;
  for (const { uid, file } of onStock) {
    const lookalike = LOOKALIKES[file];
    if (!lookalike) continue;
    const config = normalizeAvatarConfig({ v: 1, ...lookalike });
    const png = new Resvg(renderAvatarSvg(config), { fitTo: { mode: 'width', value: 256 } })
      .render()
      .asPng();
    const path = `user-avatars/${uid}.png`;
    const token = randomUUID();
    await bucket.file(path).save(png, {
      contentType: 'image/png',
      metadata: { metadata: { uploadedBy: uid, firebaseStorageDownloadTokens: token } },
    });
    await db
      .collection('users')
      .doc(uid)
      .update({
        avatarUrl: downloadUrl(bucket, path, token),
        avatarConfig: config,
        updatedAt: FieldValue.serverTimestamp(),
      });
    converted++;
    console.log(`    ${uid}: ${file} → ${path}`);
  }
  console.log(`==> converted ${converted} user(s)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
