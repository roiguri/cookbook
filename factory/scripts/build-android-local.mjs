/**
 * Local WSL2 Android APK Builder (0 EAS Cloud Builds).
 *
 * Uses Expo CNG (`expo prebuild --platform android`) + cached Gradle builds
 * (`--build-cache`) to build:
 *   - `--variant=e2e`     -> release-bundled E2E APK (`com.roiguri.cookbook.e2e`) for local DTU & Maestro
 *   - `--variant=staging` -> keystore-signed staging APK (`com.roiguri.cookbook.staging`)
 *
 * Skips redundant `expo prebuild` when the native fingerprint (`package.json` +
 * `app.config.ts` + variant) has not changed unless `--clean` is passed.
 *
 * Usage:
 *   node factory/scripts/build-android-local.mjs [--variant=e2e|staging] [--clean] [--out-apk=<path>]
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
const STAGING_KEYSTORE = path.join(MOBILE_DIR, 'config/staging/staging.keystore');

function loadFactoryEnvDefaults() {
  const envFile = path.join(os.homedir(), '.config/cookbook-factory/env');
  if (!fs.existsSync(envFile)) return {};
  const out = {};
  const res = spawnSync('bash', ['-lc', `set -a; source "${envFile}" >/dev/null 2>&1; env -0`], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  if (res.status === 0 && res.stdout) {
    for (const entry of res.stdout.split('\0')) {
      const eq = entry.indexOf('=');
      if (eq > 0) {
        const key = entry.slice(0, eq);
        if (!process.env[key]) out[key] = entry.slice(eq + 1);
      }
    }
  }
  return out;
}

const factoryEnvDefaults = loadFactoryEnvDefaults();
const mergedBaseEnv = { ...factoryEnvDefaults, ...process.env };

const variantArg = process.argv.find((a) => a.startsWith('--variant='));
const VARIANT = variantArg ? variantArg.slice('--variant='.length) : 'e2e';
const outApkArg = process.argv.find((a) => a.startsWith('--out-apk='));
const OUT_APK = outApkArg ? path.resolve(outApkArg.slice('--out-apk='.length)) : '';
const CLEAN = process.argv.includes('--clean');

if (!['e2e', 'staging'].includes(VARIANT)) {
  console.error(`Unsupported variant "${VARIANT}". Use --variant=e2e or --variant=staging.`);
  process.exit(1);
}

const defaultAndroidSdk = path.join(os.homedir(), 'Android/Sdk');
const androidSdk =
  mergedBaseEnv.ANDROID_HOME ||
  mergedBaseEnv.ANDROID_SDK_ROOT ||
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

if (VARIANT === 'staging') {
  if (!fs.existsSync(STAGING_KEYSTORE)) {
    console.error(`Staging keystore not found at ${STAGING_KEYSTORE}`);
    process.exit(1);
  }
  if (!mergedBaseEnv.STAGING_KEYSTORE_PASSWORD || !mergedBaseEnv.STAGING_KEY_ALIAS) {
    console.error(
      'STAGING_KEYSTORE_PASSWORD and STAGING_KEY_ALIAS are required to sign the staging APK.',
    );
    process.exit(1);
  }
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

function runOrDie(cmd, args, cwd, env, logArgs = args) {
  console.log(`\n$ ${cmd} ${logArgs.join(' ')}`);
  const res = spawnSync(cmd, args, { cwd, env, stdio: 'inherit' });
  if (res.error) throw res.error;
  if (res.status !== 0) process.exit(res.status || 1);
}

/**
 * Idempotently ensure MainActivity.onNewIntent updates the Activity intent via
 * setIntent(intent) so cold-start deep links delivered before Hermes boots are
 * always available to Linking.getInitialURL().
 */
function ensureMainActivityOnNewIntent() {
  const pkgPath =
    VARIANT === 'staging' ? 'com/roiguri/cookbook/staging' : 'com/roiguri/cookbook/e2e';
  const mainActivityPath = path.join(ANDROID_DIR, 'app/src/main/java', pkgPath, 'MainActivity.kt');
  if (!fs.existsSync(mainActivityPath)) return;
  let content = fs.readFileSync(mainActivityPath, 'utf8');
  if (content.includes('override fun onNewIntent(')) return;

  if (!content.includes('import android.content.Intent')) {
    content = content.replace(
      'import android.os.Build',
      'import android.content.Intent\nimport android.os.Build',
    );
  }
  content = content.replace(
    /(override fun onCreate\(savedInstanceState: Bundle\?\) \{[\s\S]*?\n  \})/,
    `$1\n\n  override fun onNewIntent(intent: Intent) {\n    setIntent(intent)\n    super.onNewIntent(intent)\n  }`,
  );
  fs.writeFileSync(mainActivityPath, content, 'utf8');
}

/**
 * Idempotently inject optional Gradle property-driven staging signing config
 * into android/app/build.gradle so keystore passwords never touch disk.
 */
function ensureGradleStagingSigningConfig() {
  const appGradlePath = path.join(ANDROID_DIR, 'app/build.gradle');
  if (!fs.existsSync(appGradlePath)) return;
  let content = fs.readFileSync(appGradlePath, 'utf8');
  if (content.includes('COOKBOOK_STORE_FILE')) return;

  const signingBlock = `
        staging {
            if (project.hasProperty('COOKBOOK_STORE_FILE')) {
                storeFile file(project.property('COOKBOOK_STORE_FILE'))
                storePassword project.property('COOKBOOK_STORE_PASSWORD')
                keyAlias project.property('COOKBOOK_KEY_ALIAS')
                keyPassword project.property('COOKBOOK_KEY_PASSWORD')
            }
        }`;

  content = content.replace(
    /(signingConfigs\s*\{[\s\S]*?debug\s*\{[\s\S]*?\})/,
    `$1${signingBlock}`,
  );
  content = content.replace(
    /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/,
    `$1signingConfig project.hasProperty('COOKBOOK_STORE_FILE') ? signingConfigs.staging : signingConfigs.debug`,
  );
  fs.writeFileSync(appGradlePath, content, 'utf8');
}

const env = {
  ...mergedBaseEnv,
  CI: '1',
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
  if (CLEAN || (prevFp && prevFp !== fp)) prebuildArgs.push('--clean');
  runOrDie('npx', prebuildArgs, MOBILE_DIR, env);
  fs.writeFileSync(FINGERPRINT_FILE, `${fp}\n`);
} else {
  console.log(`[build-android] Native fingerprint unchanged (${fp}) — skipping expo prebuild.`);
}

// Enable Gradle build cache and enforce strict WSL2 memory/worker caps
const gradlePropsPath = path.join(ANDROID_DIR, 'gradle.properties');
if (fs.existsSync(gradlePropsPath)) {
  let props = fs.readFileSync(gradlePropsPath, 'utf8');
  if (!props.includes('org.gradle.caching=true')) {
    props += '\norg.gradle.caching=true\n';
  }
  const jvmArgsLine = 'org.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=384m';
  if (/^org\.gradle\.jvmargs=.*$/m.test(props)) {
    props = props.replace(/^org\.gradle\.jvmargs=.*$/m, jvmArgsLine);
  } else {
    props += `\n${jvmArgsLine}\n`;
  }
  if (/^org\.gradle\.workers\.max=.*$/m.test(props)) {
    props = props.replace(/^org\.gradle\.workers\.max=.*$/m, 'org.gradle.workers.max=2');
  } else {
    props += 'org.gradle.workers.max=2\n';
  }
  fs.writeFileSync(gradlePropsPath, props, 'utf8');
}

ensureMainActivityOnNewIntent();

if (VARIANT === 'staging') {
  ensureGradleStagingSigningConfig();
}

// Both e2e and staging build a self-contained Hermes release APK (embedded JS
// bundle, zero Metro server required at test time). For e2e on local x86_64
// emulators, restrict native ABIs to x86_64 (~4x faster native builds).
const gradleTask = 'assembleRelease';
const gradleArgs = [gradleTask, '--build-cache', '--max-workers=2'];
const loggedGradleArgs = [gradleTask, '--build-cache', '--max-workers=2'];
if (VARIANT === 'e2e' && process.arch === 'x64') {
  gradleArgs.push('-PreactNativeArchitectures=x86_64');
  loggedGradleArgs.push('-PreactNativeArchitectures=x86_64');
}
if (VARIANT === 'staging') {
  const keyPass = mergedBaseEnv.STAGING_KEY_PASSWORD || mergedBaseEnv.STAGING_KEYSTORE_PASSWORD;
  gradleArgs.push(
    `-PCOOKBOOK_STORE_FILE=${STAGING_KEYSTORE}`,
    `-PCOOKBOOK_STORE_PASSWORD=${mergedBaseEnv.STAGING_KEYSTORE_PASSWORD}`,
    `-PCOOKBOOK_KEY_ALIAS=${mergedBaseEnv.STAGING_KEY_ALIAS}`,
    `-PCOOKBOOK_KEY_PASSWORD=${keyPass}`,
  );
  loggedGradleArgs.push(
    `-PCOOKBOOK_STORE_FILE=${STAGING_KEYSTORE}`,
    '-PCOOKBOOK_STORE_PASSWORD=***',
    `-PCOOKBOOK_KEY_ALIAS=${mergedBaseEnv.STAGING_KEY_ALIAS}`,
    '-PCOOKBOOK_KEY_PASSWORD=***',
  );
}

const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
try {
  runOrDie(gradlew, gradleArgs, ANDROID_DIR, env, loggedGradleArgs);
} finally {
  // Always stop Gradle & Kotlin daemons immediately to free WSL2 RAM while preserving --build-cache
  console.log('\n[build-android] Stopping Gradle daemons to reclaim WSL2 RAM...');
  spawnSync(gradlew, ['--stop'], { cwd: ANDROID_DIR, env, stdio: 'inherit' });
}

const apkRel = 'app/build/outputs/apk/release/app-release.apk';
const apkFull = path.join(ANDROID_DIR, apkRel);

if (!fs.existsSync(apkFull)) {
  console.error(`Expected APK not found at ${apkFull}`);
  process.exit(1);
}

if (OUT_APK) {
  fs.mkdirSync(path.dirname(OUT_APK), { recursive: true });
  fs.copyFileSync(apkFull, OUT_APK);
  console.log(`[build-android] Copied ${VARIANT} APK to ${OUT_APK}`);
}

console.log(`\n[build-android] Built ${VARIANT} APK: ${apkFull}`);
