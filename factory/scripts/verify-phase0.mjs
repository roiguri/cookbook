/**
 * Phase 0 Readiness Verifier ($0 Upfront, 0 EAS Cloud Builds, Staging-Only).
 *
 * Audits local WSL2 Android-first build & validator tools (Node, Java, Android
 * SDK/ADB/Emulator, Docker, Firebase CLI, GitHub CLI), git/Firebase production
 * isolation invariants (`native-mobile` branch, staging-only configs), and free
 * Phase 0 staging prerequisites (no EAS cloud token or paid store accounts).
 *
 * Usage:
 *   node factory/scripts/verify-phase0.mjs           # diagnostic report (exit 0 unless hard safety violation)
 *   node factory/scripts/verify-phase0.mjs --strict  # exit 1 if any Phase 0 item is still TODO
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STRICT = process.argv.includes('--strict');

const STAGING_PROJECT_ID = 'cook-book-test-479e8';
const PROD_PROJECT_ID = 'my-cook-book-67fde';
const FACTORY_BRANCH = 'native-mobile';

const results = [];

function record(status, category, label, detail = '') {
  results.push({ status, category, label, detail });
}

function run(cmd, args) {
  return spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
  });
}

function checkBin(bin, versionArgs = ['--version'], required = true) {
  const res = run(bin, versionArgs);
  const combined = `${res.stdout || ''}\n${res.stderr || ''}`
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('INFO ') && !line.startsWith('┌'));
  if (res.error || (res.status !== 0 && combined.length === 0)) {
    record(
      required ? 'TODO' : 'WARN',
      'toolchain',
      `${bin} CLI`,
      res.error ? res.error.message : combined[0] || `exit ${res.status}`,
    );
    return null;
  }
  const versionLine =
    combined.find((line) => /version|\d+\.\d+/i.test(line)) || combined[0] || 'installed';
  record('PASS', 'toolchain', `${bin} CLI`, versionLine);
  return versionLine;
}

// 1. Local WSL2 Toolchain Checks (0 EAS cloud builds required)
const nodeMajor = Number(process.versions.node.split('.')[0]);
record(
  nodeMajor >= 22 ? 'PASS' : 'FAIL',
  'toolchain',
  'Node.js >= 22',
  `v${process.versions.node}`,
);
checkBin('java', ['-version']);
checkBin('firebase', ['--version']);
checkBin('gh', ['--version']);
checkBin('docker', ['--version']);
checkBin('adb', ['version']);
checkBin('emulator', ['-version']);

const androidSdkDir = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '';
if (androidSdkDir && fs.existsSync(androidSdkDir)) {
  record('PASS', 'toolchain', 'ANDROID_HOME (local Gradle builds)', androidSdkDir);
} else {
  record(
    'TODO',
    'toolchain',
    'ANDROID_HOME (local Gradle builds)',
    'Set ANDROID_HOME / ANDROID_SDK_ROOT with Android platform + build-tools for local `expo prebuild` + Gradle APKs',
  );
}

// 2. Hard Branch & Production-Isolation Safety Checks
const branchRes = run('git', ['branch', '--show-current']);
const currentBranch = (branchRes.stdout || '').trim();
if (!currentBranch) {
  record('WARN', 'safety', 'Git branch check', 'Detached HEAD or git unavailable');
} else if (currentBranch === 'main' || currentBranch === 'staging') {
  record(
    'FAIL',
    'safety',
    'Never run factory on main or staging',
    `Current branch is "${currentBranch}" (expected "${FACTORY_BRANCH}")`,
  );
} else if (currentBranch !== FACTORY_BRANCH) {
  record(
    'WARN',
    'safety',
    `Factory branch policy (${FACTORY_BRANCH})`,
    `Current branch is "${currentBranch}"`,
  );
} else {
  record('PASS', 'safety', 'Factory branch policy', currentBranch);
}

const firebasercPath = path.join(ROOT, '.firebaserc');
if (fs.existsSync(firebasercPath)) {
  const rc = JSON.parse(fs.readFileSync(firebasercPath, 'utf8'));
  const staging = rc?.projects?.staging;
  const prod = rc?.projects?.production;
  if (staging === STAGING_PROJECT_ID && prod === PROD_PROJECT_ID && staging !== prod) {
    record('PASS', 'safety', '.firebaserc staging/prod split', `staging=${staging}`);
  } else {
    record(
      'FAIL',
      'safety',
      '.firebaserc staging/prod split',
      `Unexpected projects: staging=${staging}, production=${prod}`,
    );
  }
} else {
  record('FAIL', 'safety', '.firebaserc present', 'Missing .firebaserc');
}

// Ensure no production Firebase config accidentally exists in staging mobile config dir
const stagingConfigDir = path.join(ROOT, 'apps/mobile/config/staging');
for (const file of ['google-services.json', 'GoogleService-Info.plist']) {
  const fullPath = path.join(stagingConfigDir, file);
  if (!fs.existsSync(fullPath)) {
    record(
      'TODO',
      'phase0-staging',
      `Staging Firebase config: apps/mobile/config/staging/${file}`,
      `Download from Firebase Console (${STAGING_PROJECT_ID}) for com.roiguri.cookbook.staging`,
    );
  } else {
    const raw = fs.readFileSync(fullPath, 'utf8');
    if (raw.includes(PROD_PROJECT_ID)) {
      record(
        'FAIL',
        'safety',
        `Production project leaked in ${file}`,
        `Found ${PROD_PROJECT_ID} inside staging config!`,
      );
    } else if (!raw.includes(STAGING_PROJECT_ID)) {
      record(
        'WARN',
        'phase0-staging',
        `Verify projectId in ${file}`,
        `Expected ${STAGING_PROJECT_ID}`,
      );
    } else {
      record('PASS', 'phase0-staging', `Staging Firebase config: ${file}`, STAGING_PROJECT_ID);
    }
  }
}

const stagingKeystorePath = path.join(stagingConfigDir, 'staging.keystore');
if (fs.existsSync(stagingKeystorePath)) {
  record('PASS', 'phase0-staging', 'Local Android staging keystore', stagingKeystorePath);
} else {
  record(
    'TODO',
    'phase0-staging',
    'Local Android staging keystore (apps/mobile/config/staging/staging.keystore)',
    'Generate once via `keytool` (gitignored) for local Gradle signed staging APKs',
  );
}

// 3. Free Phase 0 Secrets (0 EAS / 0 Paid Developer Accounts)
const secretSpecs = [
  [
    'FIREBASE_APP_DIST_TOKEN',
    'Firebase App Distribution auth for staging (`firebase appdistribution:distribute` on cook-book-test-479e8)',
  ],
  [
    'HOLDOUT_REPO_DEPLOY_KEY',
    'Read-only SSH deploy key for private roiguri/cookbook-factory-holdout (local validator container + gated macos-15 CI)',
  ],
  ['EXPO_PUBLIC_SENTRY_DSN_STAGING', 'Sentry mobile staging DSN'],
  ['SENTRY_AUTH_TOKEN', 'Sentry source-map/ProGuard upload token'],
  ['FACTORY_JUDGE_API_KEY', 'Multimodal LLM-as-a-Judge API key (separate from builder model)'],
];

for (const [envName, desc] of secretSpecs) {
  if (process.env[envName]) {
    record('PASS', 'phase0-secrets', envName, 'Present in local env');
  } else {
    record('TODO', 'phase0-secrets', `${envName}`, desc);
  }
}

// Check Android App Links placeholder reminder
const assetLinksPath = path.join(ROOT, 'public/.well-known/assetlinks.json');
if (fs.existsSync(assetLinksPath)) {
  const raw = fs.readFileSync(assetLinksPath, 'utf8');
  if (raw.includes('REPLACE_WITH_')) {
    record(
      'TODO',
      'phase0-staging',
      'Staging Android App Links SHA-256',
      'Replace placeholder in public/.well-known/assetlinks.json with local staging.keystore SHA-256 fingerprint',
    );
  } else {
    record('PASS', 'phase0-staging', 'Staging Android App Links SHA-256', 'Configured');
  }
}

// Print report
const counts = { PASS: 0, WARN: 0, TODO: 0, FAIL: 0 };
console.log(
  '\n=== Cookbook Native Software Factory — Phase 0 Readiness ($0 Local-First / 0 EAS Builds) ===\n',
);
for (const item of results) {
  counts[item.status] += 1;
  const tag = `[${item.status.padEnd(4)}]`;
  console.log(`${tag} (${item.category}) ${item.label}${item.detail ? ` — ${item.detail}` : ''}`);
}
console.log(
  `\nSummary: ${counts.PASS} PASS, ${counts.TODO} TODO, ${counts.WARN} WARN, ${counts.FAIL} FAIL\n`,
);

if (counts.FAIL > 0) {
  console.error(
    'Hard safety or requirement failure detected. Resolve FAIL items before continuing.',
  );
  process.exit(1);
}
if (STRICT && counts.TODO > 0) {
  console.error('Strict mode enabled and Phase 0 TODO items remain.');
  process.exit(1);
}
