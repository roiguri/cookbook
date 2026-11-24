/**
 * Gated macos-15 iOS Simulator Verification Trigger & Artifact Collector.
 *
 * Triggered ONLY AFTER local Android convergence passes >= 95% + 0 P0
 * violations (or during the Phase 4 Slice 00 dry run). Uses deterministic
 * reusable opt-in Git tags (`factory-ios-holdout-full`,
 * `factory-ios-holdout-slice<XX>`, or `factory-ios-smoke`) so `main` stays
 * 100% untouched AND GitHub Actions `actions/cache@v4` shares `CookbookE2E.app`
 * across JS-only fix commits on the same tag ref.
 *
 * Downloads the compiled `CookbookE2E.app` tarball plus all parallel shard
 * trajectory bundles, merges them into a unified `merged/trajectories.json`,
 * and runs the local authenticated Multimodal `agy` Judge (`concurrency: 2`).
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

function findTrajectoryFiles(rootDir) {
  const found = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === 'trajectories.json') {
        found.push(full);
      } else if (entry.isDirectory() && entry.name !== 'merged') {
        walk(full);
      }
    }
  };
  walk(rootDir);
  return found.sort();
}

function mergeShardTrajectories(outDir, trajectoryFiles) {
  if (trajectoryFiles.length === 0) return null;
  if (trajectoryFiles.length === 1) {
    return path.dirname(trajectoryFiles[0]);
  }

  const mergedDir = path.join(outDir, 'merged');
  fs.mkdirSync(mergedDir, { recursive: true });

  const mergedItems = [];
  let platform = 'ios';
  for (const file of trajectoryFiles) {
    const shardDir = path.dirname(file);
    const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (bundle.platform) platform = bundle.platform;
    for (const entry of bundle.trajectories || []) {
      const resolvedShots = (entry.screenshots || []).map((rel) =>
        path.isAbsolute(rel) ? rel : path.resolve(shardDir, rel),
      );
      mergedItems.push({
        ...entry,
        screenshots: resolvedShots,
      });
    }
  }

  mergedItems.sort((a, b) => String(a.scenarioId || '').localeCompare(String(b.scenarioId || '')));
  fs.writeFileSync(
    path.join(mergedDir, 'trajectories.json'),
    JSON.stringify({ platform, consecutivePasses: 1, trajectories: mergedItems }, null, 2),
  );
  return mergedDir;
}

export async function runGatedIosVerification({
  mode = 'holdout',
  slice = '',
  outDir = path.join(ROOT, 'factory/runs/ios-validation'),
  judgeModel = resolveJudgeModel({ fast: true }),
  deterministicOnly = false,
  cwd = ROOT,
} = {}) {
  const branch = (
    spawnSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' }).stdout || ''
  ).trim();
  if (!branch || branch === 'main' || branch === 'staging' || branch === 'development') {
    throw new Error(`Refusing iOS trigger from protected/unknown branch "${branch}".`);
  }

  const headSha = (
    spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).stdout || ''
  ).trim();

  const pushBranch = spawnSync('git', ['push', 'origin', branch], {
    cwd,
    encoding: 'utf8',
  });
  if (pushBranch.status !== 0) {
    throw new Error(`git push origin ${branch} failed: ${pushBranch.stderr}`);
  }

  const baseTag =
    mode === 'smoke'
      ? 'factory-ios-smoke'
      : slice
        ? `factory-ios-holdout-slice${String(slice).padStart(2, '0')}`
        : 'factory-ios-holdout-full';

  // Snapshot existing workflow runs before pushing the tag
  const beforeRaw = runGh(
    [
      'run',
      'list',
      '--workflow=factory-ios-validate.yml',
      '--limit',
      '15',
      '--json',
      'databaseId,headBranch,headSha',
    ],
    cwd,
  );
  const existingRuns = JSON.parse(beforeRaw || '[]');
  const existingIds = new Set(existingRuns.map((r) => String(r.databaseId)));

  // Reuse baseTag when HEAD has advanced (preserving actions/cache@v4 on the tag ref);
  // fall back to a stamped tag only if baseTag already points to this exact commit SHA.
  const remoteTagSha = (
    spawnSync('git', ['ls-remote', '--tags', 'origin', `refs/tags/${baseTag}`], {
      cwd,
      encoding: 'utf8',
    }).stdout || ''
  )
    .trim()
    .split(/\s+/)[0];

  const stamp = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, '')
    .slice(0, 14);
  const tagName = remoteTagSha === headSha ? `${baseTag}-${stamp}` : baseTag;

  const tagRes = spawnSync('git', ['tag', '-f', tagName], { cwd, encoding: 'utf8' });
  if (tagRes.status !== 0) {
    throw new Error(`git tag -f ${tagName} failed: ${tagRes.stderr}`);
  }
  const pushTag = spawnSync('git', ['push', '-f', 'origin', `refs/tags/${tagName}`], {
    cwd,
    encoding: 'utf8',
  });
  if (pushTag.status !== 0) {
    throw new Error(`git push -f origin ${tagName} failed: ${pushTag.stderr}`);
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
        '15',
        '--json',
        'databaseId,headBranch,headSha,status,conclusion',
      ],
      cwd,
    );
    const runs = JSON.parse(raw || '[]');
    const match = runs.find(
      (r) => !existingIds.has(String(r.databaseId)) && r.headBranch === tagName,
    );
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

  let trajectoriesDir = null;
  if (mode === 'holdout') {
    const trajFiles = findTrajectoryFiles(outDir);
    trajectoriesDir = mergeShardTrajectories(outDir, trajFiles);
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
    outDir: path.resolve(outDir),
    ...(model ? { judgeModel: model } : {}),
    deterministicOnly,
  })
    .then((res) => {
      const ok = res.report ? res.report.convergence.converged : res.ciPassed;
      console.log(
        `[ios-gate] run=${res.runId} tag=${res.tagName} ciPassed=${res.ciPassed} converged=${ok}`,
      );
      process.exit(ok ? 0 : 1);
    })
    .catch((err) => {
      console.error('[ios-gate] fatal:', err);
      process.exit(1);
    });
}
