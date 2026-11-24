/**
 * Isolated Holdout Validation Orchestrator.
 *
 * Mounts holdout scenarios strictly from `--holdout-dir` (read-only Docker volume
 * locally on WSL2 or CI deploy-key checkout on macos-15). Builder Agents NEVER
 * access `--holdout-dir` and receive ONLY the generated `sanitized-tickets.json`.
 *
 * Usage:
 *   # Execute Maestro scenarios against DTU + deterministic checks (and optional agy judge):
 *   node factory/validator/run-validation.mjs \
 *     --holdout-dir=/holdout \
 *     --platform=android|ios \
 *     --device=emulator-5554 \
 *     --out-dir=factory/runs/<run-id>/validation \
 *     [--suite=A,B] [--slice=00] [--consecutive=2] [--deterministic-only] [--save-trajectories]
 *
 *   # Run host Multimodal agy Judge over previously saved trajectories (Docker / iOS CI artifacts):
 *   node factory/validator/run-validation.mjs \
 *     --judge-trajectories=factory/runs/<run-id>/validation \
 *     [--judge-concurrency=4] [--model=gemini-3.8-flash-medium]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DTU_CONFIG, dtuUrls } from '../dtu/config.mjs';
import { evaluateConvergence, judgeTrajectory, resolveJudgeModel } from './judge.mjs';
import { assertZeroHoldoutLeakage } from './sanitizer.mjs';

function parseArg(prefix, fallback = '') {
  const hit = process.argv.find((a) => a.startsWith(`${prefix}=`));
  return hit ? hit.slice(prefix.length + 1) : fallback;
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}: ${await res.text()}`);
  }
  return res.json();
}

function runMaestroAsync({ flowFile, device, debugDir, env }) {
  return new Promise((resolve) => {
    const args = [];
    if (device) args.push('--device', device);
    args.push('test', '--debug-output', debugDir, '--flatten-debug-output', flowFile);

    let output = '';
    const child = spawn('maestro', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const onData = (chunk) => {
      output += chunk.toString('utf8');
      if (output.length > 32000) output = output.slice(-32000);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', (err) => resolve({ code: 1, output: err.message }));
    child.once('exit', (code) => resolve({ code: code ?? 1, output }));
  });
}

function captureFinalScreenshot({ platform, device, destPath }) {
  try {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    if (platform === 'android') {
      const args = device
        ? ['-s', device, 'exec-out', 'screencap', '-p']
        : ['exec-out', 'screencap', '-p'];
      const res = spawnSync('adb', args, { maxBuffer: 25 * 1024 * 1024 });
      if (res.status === 0 && res.stdout && res.stdout.length > 100) {
        fs.writeFileSync(destPath, res.stdout);
        return destPath;
      }
    } else if (platform === 'ios' && device) {
      const res = spawnSync('xcrun', ['simctl', 'io', device, 'screenshot', destPath]);
      if (res.status === 0 && fs.existsSync(destPath)) {
        return destPath;
      }
    }
  } catch {
    // Non-fatal: Maestro debug screenshots may still exist
  }
  return null;
}

function collectScreenshots(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  const walk = (cur) => {
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(png|jpe?g)$/i.test(entry.name)) results.push(full);
    }
  };
  walk(dir);
  return results.sort();
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIdx = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (true) {
        const i = nextIdx++;
        if (i >= items.length) break;
        results[i] = await worker(items[i], i);
      }
    }),
  );
  return results;
}

export async function runHoldoutValidation({
  holdoutDir,
  platform = 'android',
  device = '',
  outDir,
  suiteFilter = [],
  sliceFilter = [],
  consecutivePasses = 1,
  deterministicOnly = false,
  saveTrajectories = false,
  judgeModel = resolveJudgeModel(),
  dtu = dtuUrls(DTU_CONFIG),
}) {
  const manifestPath = path.join(holdoutDir, 'scenarios', 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Holdout manifest not found at ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const baseRubricPath = path.join(holdoutDir, 'rubrics', 'base-rubric.md');
  const baseRubric = fs.existsSync(baseRubricPath) ? fs.readFileSync(baseRubricPath, 'utf8') : '';

  const postAssertionsPath = path.join(holdoutDir, 'assertions', 'post-assertions.mjs');
  let runPostAssertions = () => [];
  if (fs.existsSync(postAssertionsPath)) {
    const mod = await import(pathToFileURL(postAssertionsPath).href);
    if (typeof mod.runPostAssertions === 'function') {
      runPostAssertions = mod.runPostAssertions;
    }
  }

  const selected = (manifest.scenarios || []).filter((s) => {
    if (Array.isArray(s.platforms) && !s.platforms.includes(platform)) return false;
    if (suiteFilter.length && !suiteFilter.includes(s.suite)) return false;
    if (sliceFilter.length && !sliceFilter.includes(String(s.slice))) return false;
    return true;
  });

  fs.mkdirSync(outDir, { recursive: true });

  const allJudgments = [];
  const allTickets = [];
  const savedTrajectories = [];

  for (const scenario of selected) {
    const flowFile = path.join(holdoutDir, scenario.flow);
    const rubricFile = scenario.rubric ? path.join(holdoutDir, scenario.rubric) : '';
    const domainRubric =
      rubricFile && fs.existsSync(rubricFile) ? fs.readFileSync(rubricFile, 'utf8') : '';
    const rubricText = [baseRubric, domainRubric].filter(Boolean).join('\n\n');

    let finalOutcome = null;
    let finalTrajectory = null;
    for (let passIdx = 1; passIdx <= consecutivePasses; passIdx++) {
      await fetchJson(`${dtu.seed}/seed/${scenario.seedProfile || 'baseline'}`, {
        method: 'POST',
      });
      await fetch(`${dtu.fcm}/reset`, { method: 'POST' }).catch(() => {});
      const beforeSnapshot = await fetchJson(`${dtu.seed}/snapshot`);

      const scenarioDebugDir = path.join(outDir, 'debug', `${scenario.id}-pass${passIdx}`);
      fs.mkdirSync(scenarioDebugDir, { recursive: true });

      const maestro = await runMaestroAsync({
        flowFile,
        device,
        debugDir: scenarioDebugDir,
        env: process.env,
      });

      const finalShotPath = path.join(scenarioDebugDir, 'final-screen.png');
      captureFinalScreenshot({ platform, device, destPath: finalShotPath });

      const afterSnapshot = await fetchJson(`${dtu.seed}/snapshot`);
      const fcmInbox = await fetchJson(`${dtu.fcm}/messages`).catch(() => ({ messages: [] }));
      const screenshots = collectScreenshots(scenarioDebugDir);
      const postAssertionFailures = runPostAssertions(scenario.id, {
        before: beforeSnapshot,
        after: afterSnapshot,
        fcmMessages: fcmInbox.messages || [],
      });

      const trajectory = {
        scenarioId: scenario.id,
        title: scenario.title,
        isP0: Boolean(scenario.p0),
        platform,
        route: scenario.route || '/home',
        role: scenario.role || 'approved',
        userGoal: scenario.goal || scenario.title,
        maestroStatus: maestro.code === 0 ? 'passed' : 'failed',
        screenshots,
        beforeSnapshot,
        afterSnapshot,
        postAssertionFailures,
        runtimeLogs: maestro.output,
      };
      finalTrajectory = trajectory;

      const outcome = await judgeTrajectory(trajectory, {
        rubricText,
        model: judgeModel,
        deterministicOnly,
      });
      finalOutcome = outcome;

      // Stop retrying consecutive passes if a pass fails
      if (!outcome.judgment.passed || outcome.judgment.p0Violation) break;
    }

    if (finalOutcome) {
      allJudgments.push(finalOutcome.judgment);
      allTickets.push(...finalOutcome.tickets);
    }
    if (saveTrajectories && finalTrajectory) {
      savedTrajectories.push({
        ...finalTrajectory,
        screenshots: (finalTrajectory.screenshots || []).map((p) => path.relative(outDir, p)),
        rubricText,
      });
    }
  }

  assertZeroHoldoutLeakage(allTickets);

  const convergence = evaluateConvergence(allJudgments);
  const report = {
    generatedAt: new Date().toISOString(),
    platform,
    judgeModel: deterministicOnly ? 'deterministic-only' : judgeModel,
    consecutivePasses,
    convergence,
    scenarios: allJudgments.map((j) => ({
      scenarioId: j.scenarioId,
      passed: j.passed,
      p0Violation: j.p0Violation,
      weightedScore: j.weightedScore,
      dimensions: j.dimensions,
    })),
  };

  function writeJsonReplace(filePath, data) {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // Fall through to overwrite
      }
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    try {
      fs.chmodSync(filePath, 0o666);
    } catch {
      // Non-fatal
    }
  }

  writeJsonReplace(path.join(outDir, 'validation-report.json'), report);
  writeJsonReplace(path.join(outDir, 'sanitized-tickets.json'), allTickets);
  if (saveTrajectories) {
    writeJsonReplace(path.join(outDir, 'trajectories.json'), {
      platform,
      consecutivePasses,
      trajectories: savedTrajectories,
    });
  }

  return { report, tickets: allTickets };
}

export async function judgeSavedTrajectories({
  trajectoriesDir,
  judgeModel = resolveJudgeModel(),
  concurrency = 4,
  deterministicOnly = false,
}) {
  const filePath = path.join(trajectoriesDir, 'trajectories.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(`trajectories.json not found in ${trajectoriesDir}`);
  }
  const bundle = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const items = bundle.trajectories || [];

  const cacheDir = path.join(trajectoriesDir, 'judge-cache');
  if (!deterministicOnly) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  let completed = 0;

  const outcomes = await runPool(items, concurrency, async (entry) => {
    const safeId = String(entry.scenarioId || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
    const cacheFile = path.join(cacheDir, `${safeId}.json`);
    if (!deterministicOnly && fs.existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (cached?.model === judgeModel && cached?.judgment) {
          completed += 1;
          console.log(
            `[judge] (${completed}/${items.length}) ${entry.scenarioId} [cached] passed=${cached.judgment.passed} score=${cached.judgment.weightedScore} p0=${cached.judgment.p0Violation}`,
          );
          return cached;
        }
      } catch {
        // Ignore corrupt cache entry and re-judge
      }
    }

    const resolvedShots = (entry.screenshots || [])
      .map((rel) => (path.isAbsolute(rel) ? rel : path.join(trajectoriesDir, rel)))
      .filter((p) => fs.existsSync(p));
    const trajectory = {
      ...entry,
      screenshots: resolvedShots,
    };
    const outcome = await judgeTrajectory(trajectory, {
      rubricText: entry.rubricText || '',
      model: judgeModel,
      deterministicOnly,
    });
    if (!deterministicOnly) {
      try {
        fs.writeFileSync(cacheFile, JSON.stringify(outcome, null, 2));
      } catch {
        // Non-fatal cache write failure
      }
    }
    completed += 1;
    console.log(
      `[judge] (${completed}/${items.length}) ${entry.scenarioId} passed=${outcome.judgment.passed} score=${outcome.judgment.weightedScore} p0=${outcome.judgment.p0Violation} (${Math.round((outcome.durationMs || 0) / 1000)}s)`,
    );
    return outcome;
  });

  const allJudgments = outcomes.map((o) => o.judgment);
  const allTickets = outcomes.flatMap((o) => o.tickets);
  assertZeroHoldoutLeakage(allTickets);

  const convergence = evaluateConvergence(allJudgments);
  const report = {
    generatedAt: new Date().toISOString(),
    platform: bundle.platform || items[0]?.platform || 'android',
    judgeModel: deterministicOnly ? 'deterministic-only' : judgeModel,
    consecutivePasses: bundle.consecutivePasses || 1,
    convergence,
    scenarios: allJudgments.map((j) => ({
      scenarioId: j.scenarioId,
      passed: j.passed,
      p0Violation: j.p0Violation,
      weightedScore: j.weightedScore,
      dimensions: j.dimensions,
      visualAssessment: j.visualAssessment,
    })),
  };

  const reportPath = path.join(trajectoriesDir, 'validation-report.json');
  const ticketsPath = path.join(trajectoriesDir, 'sanitized-tickets.json');
  for (const p of [reportPath, ticketsPath]) {
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch {
        // Ignore
      }
    }
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(ticketsPath, JSON.stringify(allTickets, null, 2));

  return { report, tickets: allTickets };
}

async function main() {
  const judgeDir = parseArg('--judge-trajectories');
  const deterministicOnly = process.argv.includes('--deterministic-only');
  const modelOverride = parseArg('--model');
  const judgeModel = modelOverride || resolveJudgeModel();

  if (judgeDir) {
    const concurrency = Number(parseArg('--judge-concurrency', '4')) || 4;
    const { report, tickets } = await judgeSavedTrajectories({
      trajectoriesDir: path.resolve(judgeDir),
      judgeModel,
      concurrency,
      deterministicOnly,
    });
    console.log(
      `[validator] judged platform=${report.platform} model=${report.judgeModel} converged=${report.convergence.converged} score=${report.convergence.aggregateScore}% p0Violations=${report.convergence.p0ViolationCount} tickets=${tickets.length}`,
    );
    process.exit(report.convergence.converged ? 0 : 1);
  }

  const holdoutDir = parseArg('--holdout-dir');
  if (!holdoutDir) {
    console.error('Missing required --holdout-dir=<path> (or --judge-trajectories=<dir>)');
    process.exit(1);
  }
  const platform = parseArg('--platform', 'android');
  const device = parseArg('--device', '');
  const outDir = parseArg('--out-dir', path.resolve('factory/runs/manual-validation'));
  const suiteFilter = parseArg('--suite')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const sliceFilter = parseArg('--slice')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const consecutivePasses = Number(parseArg('--consecutive', '1')) || 1;
  const saveTrajectories = process.argv.includes('--save-trajectories');

  const { report, tickets } = await runHoldoutValidation({
    holdoutDir,
    platform,
    device,
    outDir,
    suiteFilter,
    sliceFilter,
    consecutivePasses,
    deterministicOnly,
    saveTrajectories,
    judgeModel,
  });

  console.log(
    `[validator] platform=${platform} converged=${report.convergence.converged} score=${report.convergence.aggregateScore}% p0Violations=${report.convergence.p0ViolationCount} tickets=${tickets.length}`,
  );
  process.exit(report.convergence.converged ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[validator] fatal:', err);
    process.exit(1);
  });
}
