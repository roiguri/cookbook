/**
 * Unified Cookbook Digital Twin Universe (DTU) Launcher.
 *
 * Starts all four local twins (Seed Server :9200, Gemini Twin :9201, FCM Twin
 * :9202, Resize Twin :9203) alongside the Firebase Local Emulator Suite
 * (Auth :9099, Firestore :8080, Storage :9199, Functions :5001) in < 15 s on
 * both Linux/WSL2 and macOS GitHub Actions runners.
 *
 * Usage:
 *   node factory/dtu/start-dtu.mjs                       # run as foreground daemon
 *   node factory/dtu/start-dtu.mjs --seed=baseline       # start + seed baseline profile
 *   node factory/dtu/start-dtu.mjs --exec="<cmd>"        # start, run command, tear down cleanly
 *   node factory/dtu/start-dtu.mjs --seed=baseline --exec="<cmd>"
 */
import net from 'node:net';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DTU_CONFIG, ROOT, dtuUrls } from './config.mjs';
import { startGeminiTwin } from './gemini-twin/server.mjs';
import { startFcmTwin } from './fcm-twin/server.mjs';
import { startResizeTwin } from './resize-twin/server.mjs';
import { startSeedServer } from './seed-server/server.mjs';

function parseArg(prefix) {
  const hit = process.argv.find((a) => a.startsWith(`${prefix}=`));
  return hit ? hit.slice(prefix.length + 1) : null;
}

function isTcpPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    const done = () => {
      socket.destroy();
      resolve(false);
    };
    socket.once('error', done);
    socket.once('timeout', done);
  });
}

async function waitForPorts(host, ports, { timeoutMs = 90000, isAborted = () => false } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isAborted()) {
      throw new Error('Firebase Emulators exited prematurely before DTU ports opened');
    }
    const checks = await Promise.all(ports.map((p) => isTcpPortOpen(host, p)));
    if (checks.every(Boolean)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for DTU ports: ${ports.join(', ')}`);
}

async function waitForFunctionsReady(
  functionsBaseUrl,
  { timeoutMs = 90000, isAborted = () => false } = {},
) {
  const deadline = Date.now() + timeoutMs;
  // Probe a real HTTP endpoint on Functions emulator — 401 from recipeApi proves Functions loaded
  while (Date.now() < deadline) {
    if (isAborted()) {
      throw new Error('Firebase Emulators exited prematurely while loading Cloud Functions');
    }
    try {
      const res = await fetch(`${functionsBaseUrl}/recipeApi/v1/me`);
      if (res.status === 401 || res.status === 200 || res.status === 404) return;
    } catch {
      // still booting
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Timed out waiting for Functions emulator to finish loading functions');
}

export async function startDtu({ seedProfile = null, quiet = false } = {}) {
  const t0 = Date.now();
  const urls = dtuUrls(DTU_CONFIG);
  const log = (...args) => {
    if (!quiet) console.log('[dtu]', ...args);
  };

  // 1. Start the 4 in-process twin HTTP servers first so Functions Emulator sees them immediately
  const gemini = await startGeminiTwin();
  const fcm = await startFcmTwin();
  const resize = await startResizeTwin();
  const seed = await startSeedServer();
  log(`Twins ready: seed=${seed.url}, gemini=${gemini.url}, fcm=${fcm.url}, resize=${resize.url}`);

  // 2. Spawn Firebase Local Emulator Suite with twin env vars wired into Functions.
  // Strip GOOGLE_APPLICATION_CREDENTIALS so emulators can never accidentally use host ADC.
  const emuEnv = {
    ...process.env,
    XDG_CONFIG_HOME: '/tmp',
    NO_UPDATE_NOTIFIER: '1',
    FUNCTIONS_EMULATOR: 'true',
    GEMINI_TWIN_URL: gemini.url,
    FCM_TWIN_URL: fcm.url,
  };
  delete emuEnv.GOOGLE_APPLICATION_CREDENTIALS;

  const emuProc = spawn(
    'firebase',
    [
      'emulators:start',
      '--only',
      'auth,firestore,storage,functions',
      '--project',
      DTU_CONFIG.projectId,
    ],
    {
      cwd: ROOT,
      env: emuEnv,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let emuExited = false;
  let emuOutput = '';
  const capture = (chunk) => {
    const text = chunk.toString('utf8');
    emuOutput += text;
    if (emuOutput.length > 16000) emuOutput = emuOutput.slice(-16000);
    if (!quiet && process.env.DTU_VERBOSE === 'true') process.stderr.write(text);
  };
  emuProc.stdout.on('data', capture);
  emuProc.stderr.on('data', capture);
  emuProc.on('exit', () => {
    emuExited = true;
  });

  function signalEmulatorGroup(sig) {
    if (!emuProc.pid) return;
    try {
      // Negative PID signals the entire process group (firebase + Java child emulators)
      process.kill(-emuProc.pid, sig);
    } catch {
      try {
        emuProc.kill(sig);
      } catch {
        // already gone
      }
    }
  }

  async function stop() {
    if (!emuExited && emuProc.pid) {
      signalEmulatorGroup('SIGINT');
      await new Promise((resolve) => {
        const killTimer = setTimeout(() => {
          if (!emuExited) signalEmulatorGroup('SIGKILL');
          resolve();
        }, 5000);
        emuProc.once('exit', () => {
          clearTimeout(killTimer);
          resolve();
        });
      });
    } else if (emuProc.pid) {
      // Best-effort sweep in case any child Java emulator survived firebase exit
      signalEmulatorGroup('SIGKILL');
    }
    await Promise.all([gemini.close(), fcm.close(), resize.close(), seed.close()]);
  }

  try {
    const waitOpts = { timeoutMs: 90000, isAborted: () => emuExited };
    await waitForPorts(
      DTU_CONFIG.host,
      [
        DTU_CONFIG.ports.auth,
        DTU_CONFIG.ports.firestore,
        DTU_CONFIG.ports.storage,
        DTU_CONFIG.ports.functions,
      ],
      waitOpts,
    );
    await waitForFunctionsReady(urls.functions, waitOpts);

    let seedResult = null;
    if (seedProfile) {
      seedResult = await seed.seedProfile(seedProfile);
      log(
        `Seeded profile "${seedProfile}" (${seedResult.docCount} docs, ${seedResult.fileCount} files)`,
      );
    }

    const elapsedMs = Date.now() - t0;
    log(`Cookbook DTU ready in ${(elapsedMs / 1000).toFixed(2)}s`);
    return { urls, elapsedMs, seedResult, stop };
  } catch (err) {
    await stop();
    throw new Error(`${err.message}\n--- Firebase Emulator Output ---\n${emuOutput}`);
  }
}

async function main() {
  const seedProfile = parseArg('--seed');
  const execCmd = parseArg('--exec');
  const quiet = process.argv.includes('--quiet');

  const dtu = await startDtu({ seedProfile, quiet });

  const shutdown = async (code = 0) => {
    await dtu.stop();
    process.exit(code);
  };
  process.once('SIGINT', () => shutdown(130));
  process.once('SIGTERM', () => shutdown(143));

  if (execCmd) {
    const child = spawn(execCmd, {
      cwd: ROOT,
      shell: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        DTU_SEED_URL: dtu.urls.seed,
        DTU_GEMINI_URL: dtu.urls.gemini,
        DTU_FCM_URL: dtu.urls.fcm,
        DTU_RESIZE_URL: dtu.urls.resize,
        DTU_FUNCTIONS_URL: dtu.urls.functions,
        FIREBASE_AUTH_EMULATOR_HOST: `${DTU_CONFIG.host}:${DTU_CONFIG.ports.auth}`,
        FIRESTORE_EMULATOR_HOST: `${DTU_CONFIG.host}:${DTU_CONFIG.ports.firestore}`,
        FIREBASE_STORAGE_EMULATOR_HOST: `${DTU_CONFIG.host}:${DTU_CONFIG.ports.storage}`,
      },
    });
    child.on('exit', (code) => {
      shutdown(code ?? 1);
    });
    return;
  }

  console.log('\nCookbook DTU endpoints:');
  for (const [name, url] of Object.entries(dtu.urls)) {
    console.log(`  - ${name.padEnd(10)}: ${url}`);
  }
  console.log('\nPress Ctrl+C to stop the DTU.');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[dtu] startup failed:', err);
    process.exit(1);
  });
}
