/**
 * Local WSL2 Android Emulator Smoke Runner (0 CI Minutes, 0 EAS Builds).
 *
 * 1. Boots `cookbook_e2e` AVD on demand with `-memory 1536` (or attaches to an
 *    explicit `--device=emulator-*`), never touching any physical phone.
 * 2. Wires `adb reverse` for all 8 Cookbook DTU ports so the app reaches
 *    host loopback (`127.0.0.1`) deterministically.
 * 3. Installs the locally built E2E APK.
 * 4. Boots the Cookbook DTU (`--seed=baseline`), executes Maestro smoke flow
 *    `apps/mobile/.maestro/smoke/boot-dtu.yml`, and ALWAYS stops both DTU and
 *    the emulator in `finally` to reclaim WSL2 RAM.
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
const avdName =
  process.argv.find((a) => a.startsWith('--avd='))?.slice('--avd='.length) || 'cookbook_e2e';

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

function listEmulators() {
  const adbList = runCheck('adb', ['devices']);
  return (adbList.stdout || '')
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.endsWith('\tdevice'))
    .map((l) => l.split('\t')[0])
    .filter((id) => id.startsWith('emulator-'));
}

async function ensureEmulatorBooted() {
  if (explicitDevice) return explicitDevice;
  let emulators = listEmulators();
  if (emulators.length > 0) return emulators[0];

  console.log(`[android-smoke] Booting on-demand Android AVD "${avdName}" (-memory 1536)...`);
  const emuBin = path.join(androidSdk, 'emulator/emulator');
  const child = spawn(
    emuBin,
    [
      '-avd',
      avdName,
      '-memory',
      '1536',
      '-no-window',
      '-no-audio',
      '-no-boot-anim',
      '-gpu',
      'swiftshader_indirect',
    ],
    { env: childEnv, detached: true, stdio: 'ignore' },
  );
  child.unref();

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    emulators = listEmulators();
    if (emulators.length > 0) {
      const serial = emulators[0];
      const bootProp = runCheck('adb', ['-s', serial, 'shell', 'getprop', 'sys.boot_completed']);
      if ((bootProp.stdout || '').trim() === '1') {
        for (const key of [
          'window_animation_scale',
          'transition_animation_scale',
          'animator_duration_scale',
        ]) {
          runCheck('adb', ['-s', serial, 'shell', 'settings', 'put', 'global', key, '0']);
        }
        return serial;
      }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Timed out waiting for Android AVD "${avdName}" to boot.`);
}

async function stopEmulator(deviceSerial) {
  if (!deviceSerial || !deviceSerial.startsWith('emulator-')) return;
  console.log(`[android-smoke] Tearing down emulator ${deviceSerial} to reclaim WSL2 RAM...`);
  runCheck('adb', ['-s', deviceSerial, 'emu', 'kill']);
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (!listEmulators().includes(deviceSerial)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

if (!fs.existsSync(apkPath)) {
  console.error(`E2E APK not found at ${apkPath}. Run \`npm run mobile:build:android\` first.`);
  process.exit(1);
}

const maestroProbe = runCheck('maestro', ['--version']);
if (maestroProbe.error || maestroProbe.status !== 0) {
  console.error('Maestro CLI is not installed. Install via https://maestro.mobile.dev/.');
  process.exit(1);
}

async function main() {
  const deviceSerial = await ensureEmulatorBooted();
  console.log(`[android-smoke] Targeting Android device: ${deviceSerial}`);

  let dtu = null;
  try {
    for (const port of Object.values(DTU_CONFIG.ports)) {
      const rev = runCheck('adb', ['-s', deviceSerial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
      if (rev.status !== 0) {
        throw new Error(`adb reverse failed for port ${port}: ${rev.stderr}`);
      }
    }

    runCheck('adb', [
      '-s',
      deviceSerial,
      'shell',
      'am',
      'broadcast',
      '-a',
      'android.intent.action.CLOSE_SYSTEM_DIALOGS',
    ]);
    runCheck('adb', ['-s', deviceSerial, 'shell', 'input', 'keyevent', 'KEYCODE_HOME']);

    console.log(`[android-smoke] Installing ${apkPath} on ${deviceSerial}...`);
    const install = spawnSync('adb', ['-s', deviceSerial, 'install', '-r', apkPath], {
      stdio: 'inherit',
      env: childEnv,
    });
    if (install.status !== 0) {
      throw new Error(`adb install failed with exit code ${install.status}`);
    }

    dtu = await startDtu({ seedProfile: 'baseline' });
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
    if (dtu) await dtu.stop();
    await stopEmulator(deviceSerial);
  }
}

main().catch((err) => {
  console.error('[android-smoke] failed:', err);
  process.exit(1);
});
