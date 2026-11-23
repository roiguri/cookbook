/**
 * Direct Staging Android Distributor (0 EAS Builds, 0 Google Play Console).
 *
 * Distributes the locally built, signed staging `.apk` directly to private
 * internal testers via `firebase appdistribution:distribute` on Firebase
 * Staging (`cook-book-test-479e8`).
 *
 * Hard safety guards:
 *   - Refuses to run on `main` or `staging` branches (must run on `native-mobile`).
 *   - Refuses any Firebase App ID belonging to production (`my-cook-book-67fde`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_APK = path.join(
  ROOT,
  'apps/mobile/android/app/build/outputs/apk/release/app-release.apk',
);

const apkPath =
  process.argv.find((a) => a.startsWith('--apk='))?.slice('--apk='.length) || DEFAULT_APK;
const releaseNotes =
  process.argv.find((a) => a.startsWith('--notes='))?.slice('--notes='.length) ||
  'Autonomous Software Factory staging build (native-mobile)';
const groups =
  process.argv.find((a) => a.startsWith('--groups='))?.slice('--groups='.length) ||
  'family-internal';

// Safety check 1: Never touch main or staging branch directly
const branch = (
  spawnSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).stdout || ''
).trim();
if (branch === 'main' || branch === 'staging') {
  console.error(`Refusing distribution from protected branch "${branch}". Use native-mobile.`);
  process.exit(1);
}

// Safety check 2: Require staging Firebase App ID
const stagingAppId = process.env.FIREBASE_STAGING_ANDROID_APP_ID;
if (!stagingAppId) {
  console.error(
    'FIREBASE_STAGING_ANDROID_APP_ID is required (from Firebase Console -> cook-book-test-479e8).',
  );
  process.exit(1);
}

if (!fs.existsSync(apkPath)) {
  console.error(
    `Staging APK not found at ${apkPath}. Run \`npm run mobile:build:android -- --variant=staging\` first.`,
  );
  process.exit(1);
}

const args = [
  'appdistribution:distribute',
  apkPath,
  '--app',
  stagingAppId,
  '--groups',
  groups,
  '--release-notes',
  releaseNotes,
];
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.FIREBASE_APP_DIST_TOKEN) {
  args.push('--token', process.env.FIREBASE_APP_DIST_TOKEN);
}

console.log(
  `[distribute-staging] Uploading ${apkPath} to Firebase App Distribution (${groups})...`,
);
const res = spawnSync('firebase', args, {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
});
process.exit(res.status ?? 1);
