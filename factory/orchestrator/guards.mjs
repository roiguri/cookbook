/**
 * Hard Circuit Breakers & Immutable Safety Guards for the Software Factory.
 *
 * Guarantees the autonomous orchestrator:
 *   - NEVER operates on `main`, `staging`, or `development` branches.
 *   - NEVER modifies immutable backend security rules (`firestore.rules`, `storage.rules`)
 *     or production Firebase configs (`my-cook-book-67fde`).
 *   - NEVER allows private holdout files inside the repository working tree.
 *   - Halts cleanly when retry/round/CI-run circuit breakers are exceeded.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const DEFAULT_LIMITS = Object.freeze({
  MAX_CONVERGENCE_ROUNDS: Number(process.env.MAX_CONVERGENCE_ROUNDS || 10),
  MAX_SLICE_RETRIES: Number(process.env.MAX_SLICE_RETRIES || 3),
  MAX_IOS_CI_RUNS: Number(process.env.MAX_IOS_CI_RUNS || 3),
});

export const PROTECTED_BRANCHES = Object.freeze(['main', 'staging', 'development']);

export const IMMUTABLE_PATHS = Object.freeze([
  'firestore.rules',
  'storage.rules',
  'apps/mobile/config/production/',
  '.firebaserc',
]);

export function checkBranchSafety(cwd) {
  const res = spawnSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' });
  const branch = (res.stdout || '').trim();
  if (!branch) {
    return { ok: false, reason: 'Unable to determine active git branch (detached HEAD?).' };
  }
  if (PROTECTED_BRANCHES.includes(branch)) {
    return {
      ok: false,
      reason: `Refusing to run factory on protected branch "${branch}". Switch to native-mobile.`,
    };
  }
  return { ok: true, branch };
}

export function checkImmutablePathsUnmodified(cwd, baseRef = 'HEAD') {
  const diffRes = spawnSync('git', ['diff', '--name-only', baseRef], { cwd, encoding: 'utf8' });
  const stagedRes = spawnSync('git', ['diff', '--cached', '--name-only'], {
    cwd,
    encoding: 'utf8',
  });
  const touched = new Set(
    `${diffRes.stdout || ''}\n${stagedRes.stdout || ''}`
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const violations = [];
  for (const file of touched) {
    for (const rule of IMMUTABLE_PATHS) {
      if (file === rule || (rule.endsWith('/') && file.startsWith(rule))) {
        violations.push(file);
      }
    }
  }
  return {
    ok: violations.length === 0,
    violations,
    reason: violations.length ? `Immutable path(s) modified: ${violations.join(', ')}` : null,
  };
}

export function checkNoHoldoutInWorkspace(cwd) {
  const forbidden = [
    path.join(cwd, '.factory-holdout'),
    path.join(cwd, 'cookbook-factory-holdout'),
    path.join(cwd, 'factory/holdout'),
  ];
  const found = forbidden.filter((p) => fs.existsSync(p));
  return {
    ok: found.length === 0,
    found,
    reason: found.length ? `Holdout files detected inside workspace: ${found.join(', ')}` : null,
  };
}

export function checkCircuitBreakers(counters = {}, limits = DEFAULT_LIMITS) {
  if ((counters.convergenceRounds || 0) >= limits.MAX_CONVERGENCE_ROUNDS) {
    return {
      ok: false,
      breaker: 'MAX_CONVERGENCE_ROUNDS',
      reason: `Reached MAX_CONVERGENCE_ROUNDS (${limits.MAX_CONVERGENCE_ROUNDS}).`,
    };
  }
  if ((counters.iosCiRuns || 0) >= limits.MAX_IOS_CI_RUNS) {
    return {
      ok: false,
      breaker: 'MAX_IOS_CI_RUNS',
      reason: `Reached MAX_IOS_CI_RUNS (${limits.MAX_IOS_CI_RUNS}).`,
    };
  }
  for (const [sliceId, retries] of Object.entries(counters.sliceRetries || {})) {
    if (retries > limits.MAX_SLICE_RETRIES) {
      return {
        ok: false,
        breaker: 'MAX_SLICE_RETRIES',
        reason: `Slice ${sliceId} exceeded MAX_SLICE_RETRIES (${limits.MAX_SLICE_RETRIES}).`,
      };
    }
  }
  return { ok: true, breaker: null, reason: null };
}

export function runAllPreflightGuards(cwd, counters = {}, limits = DEFAULT_LIMITS) {
  const checks = [
    checkBranchSafety(cwd),
    checkImmutablePathsUnmodified(cwd),
    checkNoHoldoutInWorkspace(cwd),
    checkCircuitBreakers(counters, limits),
  ];
  const failed = checks.find((c) => !c.ok);
  return { ok: !failed, failure: failed || null, checks };
}
