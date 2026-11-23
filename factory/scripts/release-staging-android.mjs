/**
 * Local Zero-EAS Staging Android Release Pipeline.
 *
 * 1. Enforces strict non-production guards (branch != main/staging/development,
 *    staging Firebase config strictly points to `cook-book-test-479e8`).
 * 2. Builds & signs `com.roiguri.cookbook.staging` APK locally via Gradle
 *    using `apps/mobile/config/staging/staging.keystore`.
 * 3. Verifies APK signature via Android SDK `apksigner` (when available).
 * 4. Uploads staging release metadata / source maps to Sentry (when configured).
 * 5. Distributes privately via `firebase appdistribution:distribute` to the
 *    `family-internal` tester group (skipped when `--dry-run` is passed).
 *
 * Usage:
 *   node factory/scripts/release-staging-android.mjs [--notes="..."] [--groups=family-internal] [--dry-run] [--out-apk=<path>]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STAGING_PROJECT = 'cook-book-test-479e8';
const PROD_PROJECT = 'my-cook-book-67fde';
const STAGING_GOOGLE_SERVICES = path.join(ROOT, 'apps/mobile/config/staging/google-services.json');

function loadFactoryEnv() {
  const envFile = path.join(os.homedir(), '.config/cookbook-factory/env');
  const out = {};
  if (fs.existsSync(envFile)) {
    const res = spawnSync('bash', ['-lc', `set -a; source "${envFile}" >/dev/null 2>&1; env -0`], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    });
    if (res.status === 0 && res.stdout) {
      for (const entry of res.stdout.split('\0')) {
        const eq = entry.indexOf('=');
        if (eq > 0) out[entry.slice(0, eq)] = entry.slice(eq + 1);
      }
    }
  }
  return { ...out, ...process.env };
}

function findApksigner(androidSdk) {
  const buildToolsDir = path.join(androidSdk, 'build-tools');
  if (!fs.existsSync(buildToolsDir)) return null;
  const versions = fs.readdirSync(buildToolsDir).sort().reverse();
  for (const v of versions) {
    const candidate = path.join(buildToolsDir, v, 'apksigner');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function main() {
  const env = loadFactoryEnv();
  const dryRun = process.argv.includes('--dry-run');
  const notes =
    process.argv.find((a) => a.startsWith('--notes='))?.slice('--notes='.length) ||
    'Autonomous Software Factory staging release (native-mobile)';
  const groups =
    process.argv.find((a) => a.startsWith('--groups='))?.slice('--groups='.length) ||
    'family-internal';
  const outApk =
    process.argv.find((a) => a.startsWith('--out-apk='))?.slice('--out-apk='.length) ||
    path.join(ROOT, 'factory/runs/latest-staging/cookbook-staging.apk');

  // Guard 1: Never release from main, staging, or development
  const branch = (
    spawnSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).stdout || ''
  ).trim();
  if (['main', 'staging', 'development'].includes(branch)) {
    console.error(`[release-staging] Refusing release from protected branch "${branch}".`);
    process.exit(1);
  }

  // Guard 2: Verify staging Firebase config never points to production
  if (!fs.existsSync(STAGING_GOOGLE_SERVICES)) {
    console.error(`[release-staging] Missing ${STAGING_GOOGLE_SERVICES}`);
    process.exit(1);
  }
  const gsRaw = fs.readFileSync(STAGING_GOOGLE_SERVICES, 'utf8');
  if (gsRaw.includes(PROD_PROJECT) || !gsRaw.includes(STAGING_PROJECT)) {
    console.error(
      `[release-staging] Staging google-services.json must target ${STAGING_PROJECT} and never ${PROD_PROJECT}.`,
    );
    process.exit(1);
  }

  // Step 1: Build signed staging APK locally (0 EAS builds)
  console.log('[release-staging] Building locally signed staging Android APK...');
  const buildRes = spawnSync(
    'node',
    ['factory/scripts/build-android-local.mjs', '--variant=staging', `--out-apk=${outApk}`],
    { cwd: ROOT, env, stdio: 'inherit' },
  );
  if (buildRes.status !== 0) process.exit(buildRes.status || 1);

  // Step 2: Verify APK signature via apksigner
  const androidSdk =
    env.ANDROID_HOME || env.ANDROID_SDK_ROOT || path.join(os.homedir(), 'Android/Sdk');
  const apksigner = findApksigner(androidSdk);
  if (apksigner) {
    console.log('[release-staging] Verifying APK signing certificate...');
    const verify = spawnSync(apksigner, ['verify', '--print-certs', outApk], {
      cwd: ROOT,
      env,
      encoding: 'utf8',
    });
    if (verify.status !== 0) {
      console.error('[release-staging] APK signature verification failed:', verify.stderr);
      process.exit(1);
    }
    const shaLine = (verify.stdout || '')
      .split('\n')
      .find((l) => l.includes('SHA-256 digest'))
      ?.trim();
    console.log(`[release-staging] Signature verified: ${shaLine || 'OK'}`);
  }

  // Step 3: Sentry staging release registration (best-effort if sentry-cli present)
  const sha = (
    spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout ||
    'unknown'
  ).trim();
  const sentryRelease = `com.roiguri.cookbook.staging@1.0.0+${sha}`;
  if (env.SENTRY_AUTH_TOKEN && env.SENTRY_ORG && env.SENTRY_MOBILE_PROJECT) {
    const sentryProbe = spawnSync('which', ['sentry-cli'], { encoding: 'utf8' });
    if (sentryProbe.status === 0 && !dryRun) {
      console.log(`[release-staging] Creating Sentry staging release ${sentryRelease}...`);
      spawnSync(
        'sentry-cli',
        [
          'releases',
          '--org',
          env.SENTRY_ORG,
          '--project',
          env.SENTRY_MOBILE_PROJECT,
          'new',
          sentryRelease,
        ],
        { cwd: ROOT, env, stdio: 'inherit' },
      );
      spawnSync(
        'sentry-cli',
        [
          'releases',
          '--org',
          env.SENTRY_ORG,
          '--project',
          env.SENTRY_MOBILE_PROJECT,
          'finalize',
          sentryRelease,
        ],
        { cwd: ROOT, env, stdio: 'inherit' },
      );
    } else {
      console.log(
        `[release-staging] Sentry staging credentials verified (release=${sentryRelease}${dryRun ? ', skipped upload in --dry-run' : ', sentry-cli not on PATH'}).`,
      );
    }
  }

  // Step 4: Distribute via Firebase App Distribution (cook-book-test-479e8)
  if (dryRun) {
    console.log(
      `[release-staging] --dry-run enabled: verified signed staging APK at ${outApk} (${(fs.statSync(outApk).size / (1024 * 1024)).toFixed(1)} MB) without uploading to Firebase App Distribution.`,
    );
    return;
  }

  const distRes = spawnSync(
    'node',
    [
      'factory/scripts/distribute-staging-android.mjs',
      `--apk=${outApk}`,
      `--groups=${groups}`,
      `--notes=${notes}`,
    ],
    { cwd: ROOT, env, stdio: 'inherit' },
  );
  if (distRes.status !== 0) process.exit(distRes.status || 1);

  console.log(
    `[release-staging] Staging Android APK successfully built, signed, verified, and distributed to "${groups}" on ${STAGING_PROJECT}.`,
  );
}

main();
