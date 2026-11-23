/**
 * Local WSL2 Android APK Builder (0 EAS Cloud Builds).
 *
 * Uses Expo CNG (`expo prebuild --platform android`) + cached Gradle builds
 * (`--build-cache`) to build:
 *   - `--variant=e2e`     -> debug/e2e APK (`com.roiguri.cookbook.e2e`) for local DTU & Maestro
 *   - `--variant=staging` -> signed staging release APK (`com.roiguri.cookbook.staging`)
 *
 * Skips redundant `expo prebuild` when the native fingerprint (`package.json` +
 * `app.config.ts` + variant) has not changed unless `--clean` is passed.
 *
 * Usage:
 *   node factory/scripts/build-android-local.mjs [--variant=e2e|staging] [--clean]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MOBILE_DIR = path.join(ROOT, 'apps/mobile');
const ANDROID_DIR = path.join(MOBILE_DIR, 'android');
const FINGERPRINT_FILE = path.join(ANDROID_DIR, '.cookbook-native-fingerprint');

const variantArg = process.argv.find((a) => a.startsWith('--variant='));
const VARIANT = variantArg ? variantArg.slice('--variant='.length) : 'e2e';
const CLEAN = process.argv.includes('--clean');

if (!['e2e', 'staging'].includes(VARIANT)) {
  console.error(`Unsupported variant "${VARIANT}". Use --variant=e2e or --variant=staging.`);
  process.exit(1);
}

const defaultAndroidSdk = path.join(os.homedir(), 'Android/Sdk');
const androidSdk =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  (fs.existsSync(defaultAndroidSdk) ? defaultAndroidSdk : '');
if (!androidSdk || !fs.existsSync(androidSdk)) {
  console.error(
    'ANDROID_HOME / ANDROID_SDK_ROOT is not set or missing. Install Android SDK platforms + build-tools first.',
  );
  process.exit(1);
}

if (!fs.existsSync(path.join(MOBILE_DIR, 'node_modules'))) {
  console.error(
    'apps/mobile/node_modules not found. Run `npm --prefix apps/mobile install` first.',
  );
  process.exit(1);
}

function nativeFingerprint() {
  const hash = crypto.createHash('sha256');
  hash.update(`variant:${VARIANT}\n`);
  for (const rel of ['package.json', 'app.config.ts']) {
    const full = path.join(MOBILE_DIR, rel);
    if (fs.existsSync(full)) hash.update(fs.readFileSync(full));
  }
  return hash.digest('hex').slice(0, 16);
}

function runOrDie(cmd, args, cwd, env) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { cwd, env, stdio: 'inherit' });
  if (res.error) throw res.error;
  if (res.status !== 0) process.exit(res.status || 1);
}

const env = {
  ...process.env,
  APP_VARIANT: VARIANT,
  ANDROID_HOME: androidSdk,
  ANDROID_SDK_ROOT: androidSdk,
  EXPO_PUBLIC_USE_DTU: VARIANT === 'e2e' ? 'true' : 'false',
  EXPO_NO_TELEMETRY: '1',
};

const fp = nativeFingerprint();
const prevFp = fs.existsSync(FINGERPRINT_FILE)
  ? fs.readFileSync(FINGERPRINT_FILE, 'utf8').trim()
  : '';

if (CLEAN || !fs.existsSync(ANDROID_DIR) || prevFp !== fp) {
  const prebuildArgs = ['expo', 'prebuild', '--platform', 'android', '--no-install'];
  if (CLEAN) prebuildArgs.push('--clean');
  runOrDie('npx', prebuildArgs, MOBILE_DIR, env);
  fs.writeFileSync(FINGERPRINT_FILE, `${fp}\n`);
} else {
  console.log(`[build-android] Native fingerprint unchanged (${fp}) — skipping expo prebuild.`);
}

// Enable Gradle build cache for fast incremental builds
const gradlePropsPath = path.join(ANDROID_DIR, 'gradle.properties');
if (fs.existsSync(gradlePropsPath)) {
  const props = fs.readFileSync(gradlePropsPath, 'utf8');
  if (!props.includes('org.gradle.caching=true')) {
    fs.appendFileSync(gradlePropsPath, '\norg.gradle.caching=true\n');
  }
}

// Both e2e and staging build a self-contained Hermes release APK (embedded JS
// bundle, zero Metro server required at test time). For e2e on local x86_64
// emulators, restrict native ABIs to x86_64 (~4x faster native builds).
const gradleTask = 'assembleRelease';
const gradleArgs = [gradleTask, '--build-cache'];
if (VARIANT === 'e2e' && process.arch === 'x64') {
  gradleArgs.push('-PreactNativeArchitectures=x86_64');
}
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
runOrDie(gradlew, gradleArgs, ANDROID_DIR, env);

const apkRel = 'app/build/outputs/apk/release/app-release.apk';
const apkFull = path.join(ANDROID_DIR, apkRel);

if (!fs.existsSync(apkFull)) {
  console.error(`Expected APK not found at ${apkFull}`);
  process.exit(1);
}

console.log(`\n[build-android] Built ${VARIANT} APK: ${apkFull}`);
