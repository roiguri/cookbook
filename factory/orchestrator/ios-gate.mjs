/**
 * Gated macos-15 iOS Simulator Verification Trigger & Artifact Collector.
 *
 * Triggered ONLY AFTER local Android convergence passes >= 95% + 0 P0
 * violations (or during the Phase 4 Slice 00 dry run). Uses opt-in Git tags
 * (`factory-ios-holdout-slice<XX>-*`, `factory-ios-holdout-full-*`, or
 * `factory-ios-smoke-*`) so `main` stays 100% untouched.
 *
 * Downloads the compiled `CookbookE2E.app` + `factory-ios-artifacts/` from GitHub
 * Actions and runs the local authenticated Multimodal `agy` Judge over the iOS
 * trajectories & screenshots.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { judgeSavedTrajectories } from '../validator/run-validation.mjs';
import { resolveJudgeModel } from '../validator/judge.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function runGh(args, cwd = ROOT) {
  const res = spawnSync('gh', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`gh ${args.join(' ')} failed (${res.status}): ${res.stderr || res.stdout}`);
  }
  return (res.stdout || '').trim();
}

export async function runGatedIosVerification({
  mode = 'holdout',
  slice = '',
  outDir = path.join(ROOT, 'factory/runs/ios-validation'),
  judgeModel = resolveJudgeModel({ fast: true }),
  deterministicOnly = false,
  cwd = ROOT,
} = {}) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, '')
    .slice(0, 14);
  const tagName =
    mode === 'smoke'
      ? `factory-ios-smoke-${stamp}`
      : slice
        ? `factory-ios-holdout-slice${String(slice).padStart(2, '0')}-${stamp}`
        : `factory-ios-holdout-full-${stamp}`;

  // Push current native-mobile HEAD and opt-in tag
  const pushBranch = spawnSync('git', ['push', 'origin', 'native-mobile'], {
    cwd,
    encoding: 'utf8',
  });
  if (pushBranch.status !== 0) {
    throw new Error(`git push origin native-mobile failed: ${pushBranch.stderr}`);
  }

  const tagRes = spawnSync('git', ['tag', tagName], { cwd, encoding: 'utf8' });
  if (tagRes.status !== 0) {
    throw new Error(`git tag ${tagName} failed: ${tagRes.stderr}`);
  }
  const pushTag = spawnSync('git', ['push', 'origin', tagName], { cwd, encoding: 'utf8' });
  if (pushTag.status !== 0) {
    throw new Error(`git push origin ${tagName} failed: ${pushTag.stderr}`);
  }

  console.log(`[ios-gate] Triggered macos-15 workflow via tag ${tagName}. Waiting for run ID...`);

  let runId = null;
  const findDeadline = Date.now() + 90_000;
  while (Date.now() < findDeadline) {
    const raw = runGh(
      [
        'run',
        'list',
        '--workflow=factory-ios-validate.yml',
        '--limit',
        '10',
        '--json',
        'databaseId,headBranch,status,conclusion',
      ],
      cwd,
    );
    const runs = JSON.parse(raw || '[]');
    const match = runs.find((r) => r.headBranch === tagName);
    if (match) {
      runId = String(match.databaseId);
      break;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  if (!runId) {
    throw new Error(`Could not locate GitHub Actions run for tag ${tagName} within 90s.`);
  }

  console.log(`[ios-gate] Watching GitHub Actions run #${runId} on macos-15...`);
  const watchRes = spawnSync('gh', ['run', 'watch', runId, '--exit-status'], {
    cwd,
    stdio: 'inherit',
  });

  fs.mkdirSync(outDir, { recursive: true });
  console.log(`[ios-gate] Downloading artifacts for run #${runId} into ${outDir}...`);
  const dlRes = spawnSync('gh', ['run', 'download', runId, '--dir', outDir], {
    cwd,
    encoding: 'utf8',
  });
  if (dlRes.status !== 0) {
    console.warn(`[ios-gate] Artifact download warning: ${dlRes.stderr}`);
  }

  // Locate downloaded trajectories.json if holdout mode
  let trajectoriesDir = null;
  if (mode === 'holdout') {
    const walkFind = (dir) => {
      if (!fs.existsSync(dir)) return null;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isFile() && entry.name === 'trajectories.json') return dir;
        if (entry.isDirectory()) {
          const hit = walkFind(full);
          if (hit) return hit;
        }
      }
      return null;
    };
    trajectoriesDir = walkFind(outDir);
  }

  if (mode === 'holdout' && trajectoriesDir) {
    console.log(
      `[ios-gate] Judging iOS trajectories via local agy Multimodal Judge (${judgeModel})...`,
    );
    const { report, tickets } = await judgeSavedTrajectories({
      trajectoriesDir,
      judgeModel,
      concurrency: 2,
      deterministicOnly,
    });
    return {
      tagName,
      runId,
      ciPassed: watchRes.status === 0,
      trajectoriesDir,
      report,
      tickets,
    };
  }

  return {
    tagName,
    runId,
    ciPassed: watchRes.status === 0,
    trajectoriesDir,
    report: null,
    tickets: [],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode =
    process.argv.find((a) => a.startsWith('--mode='))?.slice('--mode='.length) || 'holdout';
  const slice = process.argv.find((a) => a.startsWith('--slice='))?.slice('--slice='.length) || '';
  const outDir =
    process.argv.find((a) => a.startsWith('--out-dir='))?.slice('--out-dir='.length) ||
    path.join(ROOT, 'factory/runs/ios-validation');
  const model = process.argv.find((a) => a.startsWith('--model='))?.slice('--model='.length);
  const deterministicOnly = process.argv.includes('--deterministic-only');

  runGatedIosVerification({
    mode,
    slice,
    outDir,
    ...(model ? { judgeModel: model } : {}),
    deterministicOnly,
  })
    .then((res) => {
      console.log(
        `[ios-gate] tag=${res.tagName} runId=${res.runId} ciPassed=${res.ciPassed} converged=${res.report?.convergence?.converged ?? res.ciPassed}`,
      );
      const ok = res.report ? res.report.convergence.converged : res.ciPassed;
      process.exit(ok ? 0 : 1);
    })
    .catch((err) => {
      console.error('[ios-gate] fatal:', err);
      process.exit(1);
    });
}
