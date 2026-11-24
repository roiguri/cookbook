/**
 * Cookbook Autonomous Software Factory Orchestrator (Attractor-Style State Machine).
 *
 * Coordinates visible inner gates, distinct-model AI-to-AI reviews, local
 * Android-first isolated holdout convergence, gated macos-15 iOS verification,
 * zero-EAS staging Android release, CXDB append-only trace logging, and hard
 * circuit breakers on `native-mobile`.
 *
 * Usage:
 *   node factory/orchestrator/orchestrator.mjs --mode=inner-gate [--with-android-smoke]
 *   node factory/orchestrator/orchestrator.mjs --mode=review --slice=00
 *   node factory/orchestrator/orchestrator.mjs --mode=validate-android [--slice=00] [--consecutive=1] [--run-id=<id>]
 *   node factory/orchestrator/orchestrator.mjs --mode=verify-ios [--slice=00] [--ios-mode=holdout|smoke] [--run-id=<id>]
 *   node factory/orchestrator/orchestrator.mjs --mode=release-staging [--dry-run] [--run-id=<id>]
 *   node factory/orchestrator/orchestrator.mjs --mode=status --run-id=<id>
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SLICES, validateDag } from './dag.mjs';
import { RunLedger } from './cxdb.mjs';
import { DEFAULT_LIMITS, runAllPreflightGuards } from './guards.mjs';
import { runVisibleInnerGate } from './inner-gate.mjs';
import { reviewSlice } from './reviewer.mjs';
import { runGatedIosVerification } from './ios-gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parseArg(prefix, fallback = '') {
  const hit = process.argv.find((a) => a.startsWith(`${prefix}=`));
  return hit ? hit.slice(prefix.length + 1) : fallback;
}

async function main() {
  validateDag(SLICES);

  const mode = parseArg('--mode', 'inner-gate');
  const runId =
    parseArg('--run-id') ||
    `run-${new Date()
      .toISOString()
      .replace(/[-:T.Z]/g, '')
      .slice(0, 14)}`;
  const runDir = path.join(ROOT, 'factory/runs', runId);
  const ledger = new RunLedger(runDir, { runId });

  if (mode === 'status') {
    console.log(JSON.stringify(ledger.state, null, 2));
    return;
  }

  // Enforce hard branch, immutable-path, zero-holdout, and mode-scoped circuit-breaker guards
  const scopedCounters = {
    ...ledger.state.counters,
    ...(mode !== 'validate-android' ? { convergenceRounds: 0 } : {}),
    ...(mode !== 'verify-ios' ? { iosCiRuns: 0 } : {}),
  };
  const preflight = runAllPreflightGuards(ROOT, scopedCounters, DEFAULT_LIMITS);
  if (!preflight.ok) {
    ledger.tripCircuitBreaker(preflight.failure.breaker || 'SAFETY_GUARD', preflight.failure);
    console.error(`[orchestrator] HALTED by guard: ${preflight.failure.reason}`);
    process.exit(2);
  }

  if (mode === 'inner-gate') {
    const withAndroidSmoke = process.argv.includes('--with-android-smoke');
    const skipTests = process.argv.includes('--skip-tests');
    const res = runVisibleInnerGate({ rootDir: ROOT, withTests: !skipTests, withAndroidSmoke });
    ledger.append('inner_gate', { ok: res.ok, failedCount: res.failedCount });
    for (const r of res.results) {
      console.log(`[orchestrator] gate ${r.ok ? 'PASS' : 'FAIL'} ${r.label} (${r.durationMs}ms)`);
      if (!r.ok) console.error(r.output);
    }
    process.exit(res.ok ? 0 : 1);
  }

  if (mode === 'review') {
    const slice = parseArg('--slice', '00');
    const model = parseArg('--model');
    const res = await reviewSlice({ sliceId: slice, ...(model ? { model } : {}) });
    ledger.append('slice_review', {
      sliceId: slice,
      approved: res.approved,
      blockingCount: res.blockingIssues.length,
      model: res.model,
    });
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.approved ? 0 : 1);
  }

  if (mode === 'validate-android') {
    const slice = parseArg('--slice');
    const suite = parseArg('--suite');
    const consecutive = parseArg('--consecutive', '1');
    const model = parseArg('--model');
    const skipBuild = process.argv.includes('--skip-build');
    const deterministicOnly = process.argv.includes('--deterministic-only');

    if (!skipBuild) {
      const b = spawnSync('npm', ['run', 'mobile:build:android'], { cwd: ROOT, stdio: 'inherit' });
      if (b.status !== 0) process.exit(b.status || 1);
    }

    const roundNum = ledger.state.counters.convergenceRounds + 1;
    const roundDir = path.join(runDir, `android-round-${roundNum}`);
    const args = [
      'factory/validator/run-isolated-validation.mjs',
      `--out-dir=${roundDir}`,
      `--consecutive=${consecutive}`,
    ];
    if (slice) args.push(`--slice=${slice}`);
    if (suite) args.push(`--suite=${suite}`);
    if (model) args.push(`--model=${model}`);
    if (deterministicOnly) args.push('--deterministic-only');

    const val = spawnSync('node', args, { cwd: ROOT, stdio: 'inherit' });
    const reportPath = path.join(roundDir, 'validation-report.json');
    const report = fs.existsSync(reportPath)
      ? JSON.parse(fs.readFileSync(reportPath, 'utf8'))
      : null;
    ledger.recordAndroidRound({
      slice: slice || 'all',
      outDir: roundDir,
      converged: Boolean(report?.convergence?.converged),
      aggregateScore: report?.convergence?.aggregateScore ?? 0,
      p0ViolationCount: report?.convergence?.p0ViolationCount ?? -1,
    });
    process.exit(val.status ?? 1);
  }

  if (mode === 'verify-ios') {
    const slice = parseArg('--slice');
    const iosMode = parseArg('--ios-mode', 'holdout');
    const model = parseArg('--model');
    const deterministicOnly = process.argv.includes('--deterministic-only');
    const outDir = path.join(runDir, `ios-run-${ledger.state.counters.iosCiRuns + 1}`);

    const res = await runGatedIosVerification({
      mode: iosMode,
      slice,
      outDir,
      ...(model ? { judgeModel: model } : {}),
      deterministicOnly,
    });
    ledger.recordIosRun({
      tagName: res.tagName,
      runId: res.runId,
      ciPassed: res.ciPassed,
      converged: res.report?.convergence?.converged ?? res.ciPassed,
      aggregateScore: res.report?.convergence?.aggregateScore ?? (res.ciPassed ? 100 : 0),
      p0ViolationCount: res.report?.convergence?.p0ViolationCount ?? (res.ciPassed ? 0 : 1),
    });
    const ok = res.report ? res.report.convergence.converged : res.ciPassed;
    process.exit(ok ? 0 : 1);
  }

  if (mode === 'release-staging') {
    const dryRun = process.argv.includes('--dry-run');
    const notes = parseArg(
      '--notes',
      `Autonomous Software Factory staging build (${runId}, native-mobile)`,
    );
    const outApk = path.join(runDir, 'cookbook-staging.apk');
    const args = [
      'factory/scripts/release-staging-android.mjs',
      `--notes=${notes}`,
      `--out-apk=${outApk}`,
    ];
    if (dryRun) args.push('--dry-run');

    const res = spawnSync('node', args, { cwd: ROOT, stdio: 'inherit' });
    ledger.recordStagingRelease({
      dryRun,
      ok: res.status === 0,
      apkPath: outApk,
    });
    if (res.status === 0) ledger.markCompleted({ stagingApk: outApk, dryRun });
    process.exit(res.status ?? 1);
  }

  console.error(`Unknown orchestrator --mode="${mode}"`);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[orchestrator] fatal:', err);
    process.exit(1);
  });
}
