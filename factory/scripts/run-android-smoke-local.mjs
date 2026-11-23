/**
 * Local WSL2 Android Emulator Smoke Runner (0 CI Minutes, 0 EAS Builds).
 *
 * 1. Verifies an Android Emulator / device is attached via `adb devices`.
 * 2. Wires `adb reverse` for all 8 Cookbook DTU ports so the app reaches
 *    host loopback (`127.0.0.1`) deterministically.
 * 3. Installs the locally built E2E APK.
 * 4. Boots the Cookbook DTU (`--seed=baseline`), executes Maestro smoke flow
 *    `apps/mobile/.maestro/smoke/boot-dtu.yml`, and tears down cleanly.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DTU_CONFIG } from '../dtu/config.mjs';
import { startDtu } from '../dtu/start-dtu.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_APK = path.join(
  ROOT,
  'apps/mobile/android/app/build/outputs/apk/release/app-release.apk',
);
const DEFAULT_FLOW = path.join(ROOT, 'apps/mobile/.maestro/smoke/boot-dtu.yml');

const apkPath =
  process.argv.find((a) => a.startsWith('--apk='))?.slice('--apk='.length) || DEFAULT_APK;
const flowPath =
  process.argv.find((a) => a.startsWith('--flow='))?.slice('--flow='.length) || DEFAULT_FLOW;
const explicitDevice =
  process.argv.find((a) => a.startsWith('--device='))?.slice('--device='.length) || '';

const androidSdk =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  path.join(os.homedir(), 'Android/Sdk');
const maestroBinDir = path.join(os.homedir(), '.maestro/bin');
const childEnv = {
  ...process.env,
  ANDROID_HOME: androidSdk,
  ANDROID_SDK_ROOT: androidSdk,
  PATH: [
    maestroBinDir,
    path.join(androidSdk, 'platform-tools'),
    path.join(androidSdk, 'emulator'),
    process.env.PATH || '',
  ].join(path.delimiter),
};

function runCheck(cmd, args) {
  return spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', env: childEnv });
}

if (!fs.existsSync(apkPath)) {
  console.error(`E2E APK not found at ${apkPath}. Run \`npm run mobile:build:android\` first.`);
  process.exit(1);
}

const adbList = runCheck('adb', ['devices']);
const attached = (adbList.stdout || '')
  .split('\n')
  .slice(1)
  .map((l) => l.trim())
  .filter((l) => l.endsWith('\tdevice'))
  .map((l) => l.split('\t')[0]);

// Never touch a physical phone unless explicitly passed via --device=<serial>
const deviceSerial = explicitDevice || attached.find((id) => id.startsWith('emulator-')) || '';

if (!deviceSerial) {
  console.error(
    'No running Android Emulator (emulator-*) detected by `adb devices`. Start an AVD first (e.g. `emulator -avd cookbook_e2e`) or pass `--device=<serial>`.',
  );
  process.exit(1);
}

console.log(`[android-smoke] Targeting Android device: ${deviceSerial}`);

const maestroProbe = runCheck('maestro', ['--version']);
if (maestroProbe.error || maestroProbe.status !== 0) {
  console.error('Maestro CLI is not installed. Install via https://maestro.mobile.dev/.');
  process.exit(1);
}

// Wire adb reverse for all DTU ports so Android reaches host 127.0.0.1 cleanly
for (const port of Object.values(DTU_CONFIG.ports)) {
  const rev = runCheck('adb', ['-s', deviceSerial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
  if (rev.status !== 0) {
    console.error(`adb reverse failed for port ${port}: ${rev.stderr}`);
    process.exit(1);
  }
}

console.log(`[android-smoke] Installing ${apkPath} on ${deviceSerial}...`);
const install = spawnSync('adb', ['-s', deviceSerial, 'install', '-r', apkPath], {
  stdio: 'inherit',
  env: childEnv,
});
if (install.status !== 0) process.exit(install.status || 1);

async function main() {
  const dtu = await startDtu({ seedProfile: 'baseline' });
  try {
    console.log(`[android-smoke] Running Maestro flow: ${flowPath} on ${deviceSerial}`);
    // Must use async spawn (not spawnSync) so the Node event loop keeps serving
    // the in-process DTU HTTP twins (:9200-:9203) while Maestro drives the app.
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn('maestro', ['--device', deviceSerial, 'test', flowPath], {
        cwd: ROOT,
        stdio: 'inherit',
        env: childEnv,
      });
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    });
    process.exitCode = exitCode;
  } finally {
    await dtu.stop();
  }
}

main().catch((err) => {
  console.error('[android-smoke] failed:', err);
  process.exit(1);
});
