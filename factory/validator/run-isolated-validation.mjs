/**
 * Isolated Local Android Holdout Validator (WSL2 + Read-Only Docker Container).
 *
 * Keeps `roiguri/cookbook-factory-holdout` strictly OUTSIDE the `cookbook` repo
 * (`~/.cache/cookbook-factory/holdout`), boots/attaches to `emulator-*` (never
 * touching any physical phone), runs the Cookbook DTU on host loopback, mounts
 * the holdout directory `:ro` into the isolated Docker validator container
 * (`cookbook-factory-validator:latest`) to capture trajectories + deterministic
 * post-assertions, and then executes the host authenticated `agy` Multimodal
 * Judge over the captured trajectories + screenshots to produce ONLY:
 *   - `<out-dir>/validation-report.json`
 *   - `<out-dir>/sanitized-tickets.json` (zero holdout leakage enforced)
 *
 * Usage:
 *   node factory/validator/run-isolated-validation.mjs \
 *     --out-dir=factory/runs/<run-id>/round-1 \
 *     [--slice=00] [--suite=A,B] [--consecutive=1] \
 *     [--model=gemini-3.8-flash-medium] [--skip-install] [--no-docker] [--deterministic-only]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DTU_CONFIG } from '../dtu/config.mjs';
import { startDtu } from '../dtu/start-dtu.mjs';
import { judgeSavedTrajectories, runHoldoutValidation } from './run-validation.mjs';
import { resolveJudgeModel } from './judge.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_APK = path.join(
  ROOT,
  'apps/mobile/android/app/build/outputs/apk/release/app-release.apk',
);
const HOLDOUT_CACHE_DIR = path.join(os.homedir(), '.cache/cookbook-factory/holdout');
const DOCKER_IMAGE = 'cookbook-factory-validator:latest';

function parseArg(prefix, fallback = '') {
  const hit = process.argv.find((a) => a.startsWith(`${prefix}=`));
  return hit ? hit.slice(prefix.length + 1) : fallback;
}

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
        if (eq > 0) {
          out[entry.slice(0, eq)] = entry.slice(eq + 1);
        }
      }
    }
  }
  const androidSdk =
    process.env.ANDROID_HOME ||
    out.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    path.join(os.homedir(), 'Android/Sdk');
  const maestroBin = path.join(os.homedir(), '.maestro/bin');
  return {
    ...out,
    ...process.env,
    ANDROID_HOME: androidSdk,
    ANDROID_SDK_ROOT: androidSdk,
    PATH: [
      maestroBin,
      path.join(androidSdk, 'platform-tools'),
      path.join(androidSdk, 'emulator'),
      process.env.PATH || '',
    ].join(path.delimiter),
  };
}

function syncHoldoutRepo(env) {
  const deployKey = env.HOLDOUT_REPO_DEPLOY_KEY;
  if (!deployKey) {
    throw new Error('HOLDOUT_REPO_DEPLOY_KEY is required to sync private holdout repository.');
  }

  // Ensure holdout cache is strictly outside the git workspace
  const resolvedCache = path.resolve(HOLDOUT_CACHE_DIR);
  if (resolvedCache.startsWith(ROOT)) {
    throw new Error('Holdout cache path must never live inside the workspace repository.');
  }

  fs.mkdirSync(path.dirname(resolvedCache), { recursive: true });
  const expandedKeyPath = deployKey.trim().replace(/^~(?=\/)/, os.homedir());
  let keyFile = expandedKeyPath;
  let tempKeyFile = null;
  if (!fs.existsSync(expandedKeyPath)) {
    const normalized = deployKey.includes('-----BEGIN')
      ? deployKey.replace(/\\n/g, '\n')
      : deployKey;
    tempKeyFile = path.join(os.tmpdir(), `cookbook-holdout-key-${process.pid}`);
    fs.writeFileSync(tempKeyFile, normalized.endsWith('\n') ? normalized : `${normalized}\n`, {
      mode: 0o600,
    });
    keyFile = tempKeyFile;
  }

  const gitEnv = {
    ...env,
    GIT_SSH_COMMAND: `ssh -i ${keyFile} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`,
  };

  try {
    if (fs.existsSync(path.join(resolvedCache, '.git'))) {
      const fetchRes = spawnSync('git', ['-C', resolvedCache, 'fetch', 'origin', 'main'], {
        env: gitEnv,
        encoding: 'utf8',
      });
      if (fetchRes.status !== 0) {
        throw new Error(`Holdout fetch failed: ${fetchRes.stderr}`);
      }
      const resetRes = spawnSync('git', ['-C', resolvedCache, 'reset', '--hard', 'origin/main'], {
        env: gitEnv,
        encoding: 'utf8',
      });
      if (resetRes.status !== 0) {
        throw new Error(`Holdout reset failed: ${resetRes.stderr}`);
      }
    } else {
      fs.rmSync(resolvedCache, { recursive: true, force: true });
      const cloneRes = spawnSync(
        'git',
        [
          'clone',
          '--depth',
          '1',
          'git@github.com:roiguri/cookbook-factory-holdout.git',
          resolvedCache,
        ],
        { env: gitEnv, encoding: 'utf8' },
      );
      if (cloneRes.status !== 0) {
        throw new Error(`Holdout clone failed: ${cloneRes.stderr}`);
      }
    }
  } finally {
    if (tempKeyFile) fs.rmSync(tempKeyFile, { force: true });
  }

  return resolvedCache;
}

function listEmulators(env) {
  const res = spawnSync('adb', ['devices'], { env, encoding: 'utf8' });
  return (res.stdout || '')
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.endsWith('\tdevice'))
    .map((l) => l.split('\t')[0])
    .filter((id) => id.startsWith('emulator-'));
}

async function ensureEmulatorBooted(env, avdName = 'cookbook_e2e') {
  let emulators = listEmulators(env);
  if (emulators.length > 0) {
    return emulators[0];
  }

  console.log(`[isolated-validator] Booting on-demand Android AVD "${avdName}" (-memory 1536)...`);
  const emuBin = path.join(env.ANDROID_HOME, 'emulator/emulator');
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
    {
      env,
      detached: true,
      stdio: 'ignore',
    },
  );
  child.unref();

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    emulators = listEmulators(env);
    if (emulators.length > 0) {
      const serial = emulators[0];
      const bootProp = spawnSync('adb', ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], {
        env,
        encoding: 'utf8',
      });
      if ((bootProp.stdout || '').trim() === '1') {
        console.log(`[isolated-validator] Emulator ready: ${serial}`);
        // Disable system animations for deterministic Maestro execution
        for (const key of [
          'window_animation_scale',
          'transition_animation_scale',
          'animator_duration_scale',
        ]) {
          spawnSync('adb', ['-s', serial, 'shell', 'settings', 'put', 'global', key, '0'], { env });
        }
        return serial;
      }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Timed out waiting for Android AVD "${avdName}" to finish booting.`);
}

async function stopEmulator(deviceSerial, env) {
  if (!deviceSerial || !deviceSerial.startsWith('emulator-')) return;
  console.log(`[isolated-validator] Tearing down emulator ${deviceSerial} to reclaim WSL2 RAM...`);
  spawnSync('adb', ['-s', deviceSerial, 'emu', 'kill'], { env, encoding: 'utf8' });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (!listEmulators(env).includes(deviceSerial)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

function ensureValidatorDockerImage(env) {
  const inspect = spawnSync('docker', ['image', 'inspect', DOCKER_IMAGE], {
    env,
    stdio: 'ignore',
  });
  if (inspect.status === 0) return true;
  console.log(`[isolated-validator] Building isolated Docker validator image ${DOCKER_IMAGE}...`);
  const build = spawnSync(
    'docker',
    ['build', '-t', DOCKER_IMAGE, '-f', 'factory/validator/Dockerfile', '.'],
    { cwd: ROOT, env, stdio: 'inherit' },
  );
  return build.status === 0;
}

function runDockerValidatorAsync({
  holdoutDir,
  outDir,
  device,
  sliceFilter,
  suiteFilter,
  consecutivePasses,
  env,
}) {
  return new Promise((resolve) => {
    const hostAdb = path.join(env.ANDROID_HOME, 'platform-tools/adb');
    const dockerArgs = [
      'run',
      '--rm',
      '--memory=1536m',
      '--network=host',
      '-e',
      'ANDROID_ADB_SERVER_ADDRESS=127.0.0.1',
      '-v',
      `${holdoutDir}:/holdout:ro`,
      '-v',
      `${path.join(ROOT, 'factory')}:/workspace/factory:ro`,
      '-v',
      `${path.join(ROOT, 'packages')}:/workspace/packages:ro`,
      '-v',
      `${path.join(ROOT, 'firebase.json')}:/workspace/firebase.json:ro`,
      '-v',
      `${path.join(ROOT, 'package.json')}:/workspace/package.json:ro`,
      '-v',
      `${outDir}:/out:rw`,
    ];
    if (fs.existsSync(hostAdb)) {
      dockerArgs.push('-v', `${hostAdb}:/usr/bin/adb:ro`);
    }
    dockerArgs.push(
      DOCKER_IMAGE,
      '--holdout-dir=/holdout',
      '--platform=android',
      `--device=${device}`,
      '--out-dir=/out',
      `--consecutive=${consecutivePasses}`,
      '--deterministic-only',
      '--save-trajectories',
    );
    if (sliceFilter.length) dockerArgs.push(`--slice=${sliceFilter.join(',')}`);
    if (suiteFilter.length) dockerArgs.push(`--suite=${suiteFilter.join(',')}`);

    const child = spawn('docker', dockerArgs, { env, stdio: 'inherit' });
    child.once('error', (err) => resolve({ code: 1, error: err.message }));
    child.once('exit', (code) => resolve({ code: code ?? 1 }));
  });
}

async function main() {
  const env = loadFactoryEnv();
  const outDir = path.resolve(
    parseArg('--out-dir', path.join(ROOT, 'factory/runs/isolated-validation')),
  );
  const apkPath = path.resolve(parseArg('--apk', DEFAULT_APK));
  const sliceFilter = parseArg('--slice')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const suiteFilter = parseArg('--suite')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const consecutivePasses = Number(parseArg('--consecutive', '1')) || 1;
  const judgeConcurrency = Number(parseArg('--judge-concurrency', '2')) || 2;
  const judgeModel = parseArg('--model') || resolveJudgeModel();
  const skipInstall = process.argv.includes('--skip-install');
  const noDocker = process.argv.includes('--no-docker');
  const deterministicOnly = process.argv.includes('--deterministic-only');

  fs.mkdirSync(outDir, { recursive: true });

  // 1. Sync isolated holdout repo outside the cookbook git workspace
  const holdoutDir = syncHoldoutRepo(env);

  // 2. Boot on-demand emulator-* (never physical phone) and always tear down before judging
  const deviceSerial = await ensureEmulatorBooted(env);
  console.log(`[isolated-validator] Targeting emulator: ${deviceSerial}`);

  let ranInDocker = false;
  let dtu = null;
  try {
    // 3. Wire adb reverse for all 8 Cookbook DTU ports
    for (const port of Object.values(DTU_CONFIG.ports)) {
      const rev = spawnSync('adb', ['-s', deviceSerial, 'reverse', `tcp:${port}`, `tcp:${port}`], {
        env,
        encoding: 'utf8',
      });
      if (rev.status !== 0) {
        throw new Error(`adb reverse failed on port ${port}: ${rev.stderr}`);
      }
    }

    // Dismiss any Android emulator system ANR dialogs before Maestro runs
    spawnSync(
      'adb',
      [
        '-s',
        deviceSerial,
        'shell',
        'am',
        'broadcast',
        '-a',
        'android.intent.action.CLOSE_SYSTEM_DIALOGS',
      ],
      { env },
    );
    spawnSync('adb', ['-s', deviceSerial, 'shell', 'input', 'keyevent', 'KEYCODE_HOME'], { env });

    // 4. Install E2E APK unless skipped
    if (!skipInstall) {
      if (!fs.existsSync(apkPath)) {
        throw new Error(`E2E APK not found at ${apkPath}. Build it first.`);
      }
      console.log(`[isolated-validator] Installing ${apkPath} on ${deviceSerial}...`);
      const inst = spawnSync('adb', ['-s', deviceSerial, 'install', '-r', apkPath], {
        env,
        stdio: 'inherit',
      });
      if (inst.status !== 0) {
        throw new Error(`adb install failed with exit code ${inst.status}`);
      }
    }

    // 5. Boot Cookbook DTU and execute isolated holdout validation
    dtu = await startDtu({ seedProfile: 'baseline' });
    if (!noDocker && ensureValidatorDockerImage(env)) {
      console.log(
        '[isolated-validator] Executing holdout scenarios inside read-only Docker container (--memory=1536m)...',
      );
      const dockerRes = await runDockerValidatorAsync({
        holdoutDir,
        outDir,
        device: deviceSerial,
        sliceFilter,
        suiteFilter,
        consecutivePasses,
        env,
      });
      if (fs.existsSync(path.join(outDir, 'trajectories.json'))) {
        ranInDocker = true;
      } else {
        console.warn(
          `[isolated-validator] Docker container exited (${dockerRes.code}) without trajectories; falling back to host outside-repo holdout execution.`,
        );
      }
    }

    if (!ranInDocker) {
      console.log(
        '[isolated-validator] Running holdout scenarios via host Maestro against outside-repo holdout dir...',
      );
      process.env.PATH = env.PATH;
      await runHoldoutValidation({
        holdoutDir,
        platform: 'android',
        device: deviceSerial,
        outDir,
        suiteFilter,
        sliceFilter,
        consecutivePasses,
        deterministicOnly: true,
        saveTrajectories: true,
        judgeModel,
      });
    }
  } finally {
    if (dtu) await dtu.stop();
    await stopEmulator(deviceSerial, env);
  }

  // 6. Execute authenticated Multimodal agy Judge on captured trajectories + screenshots
  const { report, tickets } = await judgeSavedTrajectories({
    trajectoriesDir: outDir,
    judgeModel,
    concurrency: judgeConcurrency,
    deterministicOnly,
  });

  console.log(
    `[isolated-validator] docker=${ranInDocker} platform=android model=${report.judgeModel} converged=${report.convergence.converged} score=${report.convergence.aggregateScore}% p0Violations=${report.convergence.p0ViolationCount} tickets=${tickets.length}`,
  );
  process.exit(report.convergence.converged ? 0 : 1);
}

main().catch((err) => {
  console.error('[isolated-validator] fatal:', err);
  process.exit(1);
});
