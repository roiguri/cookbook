/**
 * Isolated Holdout Validation Orchestrator.
 *
 * Mounts holdout scenarios strictly from `--holdout-dir` (read-only Docker volume
 * locally on WSL2 or CI deploy-key checkout on macos-15). Builder Agents NEVER
 * access `--holdout-dir` and receive ONLY the generated `sanitized-tickets.json`.
 *
 * Usage:
 *   node factory/validator/run-validation.mjs \
 *     --holdout-dir=/holdout \
 *     --platform=android|ios \
 *     --device=emulator-5554 \
 *     --out-dir=factory/runs/<run-id>/validation \
 *     [--suite=A,B] [--slice=00] [--consecutive=2] [--deterministic-only]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DTU_CONFIG, dtuUrls } from '../dtu/config.mjs';
import { evaluateConvergence, judgeTrajectory, resolveJudgeModel } from './judge.mjs';

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

export async function runHoldoutValidation({
  holdoutDir,
  platform = 'android',
  device = '',
  outDir,
  suiteFilter = [],
  sliceFilter = [],
  consecutivePasses = 1,
  deterministicOnly = false,
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

  for (const scenario of selected) {
    const flowFile = path.join(holdoutDir, scenario.flow);
    const rubricFile = scenario.rubric ? path.join(holdoutDir, scenario.rubric) : '';
    const domainRubric =
      rubricFile && fs.existsSync(rubricFile) ? fs.readFileSync(rubricFile, 'utf8') : '';
    const rubricText = [baseRubric, domainRubric].filter(Boolean).join('\n\n');

    let finalOutcome = null;
    for (let passIdx = 1; passIdx <= consecutivePasses; passIdx++) {
      await fetchJson(`${dtu.seed}/seed/${scenario.seedProfile || 'baseline'}`, {
        method: 'POST',
      });
      const beforeSnapshot = await fetchJson(`${dtu.seed}/snapshot`);

      const scenarioDebugDir = path.join(outDir, 'debug', `${scenario.id}-pass${passIdx}`);
      fs.mkdirSync(scenarioDebugDir, { recursive: true });

      const maestro = await runMaestroAsync({
        flowFile,
        device,
        debugDir: scenarioDebugDir,
        env: process.env,
      });

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
  }

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

  fs.writeFileSync(path.join(outDir, 'validation-report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(
    path.join(outDir, 'sanitized-tickets.json'),
    JSON.stringify(allTickets, null, 2),
  );

  return { report, tickets: allTickets };
}

async function main() {
  const holdoutDir = parseArg('--holdout-dir');
  if (!holdoutDir) {
    console.error('Missing required --holdout-dir=<path>');
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
  const deterministicOnly = process.argv.includes('--deterministic-only');

  const { report, tickets } = await runHoldoutValidation({
    holdoutDir,
    platform,
    device,
    outDir,
    suiteFilter,
    sliceFilter,
    consecutivePasses,
    deterministicOnly,
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
