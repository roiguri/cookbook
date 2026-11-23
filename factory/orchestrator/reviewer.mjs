/**
 * Distinct-Model AI-to-AI Slice Reviewer (powered by authenticated `agy` CLI).
 *
 * Reviews a slice's changes (both tracked diff and newly added files under its
 * owned paths) strictly against its NLSpec (`factory/specs/*.md`) and Global
 * Invariants (`factory/specs/invariants.md`) using a model distinct from the
 * builder (`resolveJudgeModel`), returning structured JSON approval or blocking
 * issues in a single fast turn without executing shell commands.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveAgyBinary, resolveJudgeModel } from '../validator/judge.mjs';
import { getSliceById } from './dag.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['approved', 'sliceId', 'blockingIssues', 'warnings', 'summary'],
  properties: {
    approved: { type: 'boolean' },
    sliceId: { type: 'string' },
    blockingIssues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'issue', 'specRef'],
        properties: {
          severity: { type: 'string', enum: ['P0', 'P1'] },
          file: { type: 'string' },
          issue: { type: 'string' },
          specRef: { type: 'string' },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
};

function collectSliceEvidence(rootDir, slice, baseRef) {
  const parts = [];

  // 1. Tracked diff for apps/mobile + scripts
  let diff = (
    spawnSync('git', ['diff', 'HEAD', '--', 'apps/mobile', 'scripts'], {
      cwd: rootDir,
      encoding: 'utf8',
    }).stdout || ''
  ).trim();
  if (!diff) {
    diff = (
      spawnSync('git', ['diff', baseRef, 'HEAD', '--', 'apps/mobile', 'scripts'], {
        cwd: rootDir,
        encoding: 'utf8',
      }).stdout || ''
    ).trim();
  }
  if (diff) {
    parts.push(`--- GIT DIFF ---\n${diff.slice(0, 28000)}`);
  }

  // 2. Include untracked new files under apps/mobile/{app,src} and scripts/
  const untracked = (
    spawnSync(
      'git',
      [
        'ls-files',
        '--others',
        '--exclude-standard',
        'apps/mobile/app',
        'apps/mobile/src',
        'scripts',
      ],
      { cwd: rootDir, encoding: 'utf8' },
    ).stdout || ''
  )
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  let budget = 26000;
  for (const rel of untracked) {
    if (budget <= 0) break;
    const full = path.join(rootDir, rel);
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) continue;
    const content = fs.readFileSync(full, 'utf8').slice(0, 3500);
    parts.push(`--- NEW FILE: ${rel} ---\n${content}`);
    budget -= content.length;
  }

  return parts.join('\n\n') || `(No diff found for slice ${slice.id})`;
}

export async function reviewSlice({
  sliceId,
  baseRef = 'HEAD~1',
  rootDir = ROOT,
  model = resolveJudgeModel({ fast: true }),
  timeoutSec = 90,
} = {}) {
  const slice = getSliceById(sliceId);
  if (!slice) throw new Error(`Unknown sliceId "${sliceId}"`);

  const specPath = path.join(rootDir, slice.spec);
  const invariantsPath = path.join(rootDir, 'factory/specs/invariants.md');
  const specText = fs.existsSync(specPath) ? fs.readFileSync(specPath, 'utf8') : '';
  const invText = fs.existsSync(invariantsPath) ? fs.readFileSync(invariantsPath, 'utf8') : '';
  const codeEvidence = collectSliceEvidence(rootDir, slice, baseRef);

  const workDir = path.join(os.tmpdir(), `cookbook-review-${crypto.randomUUID().slice(0, 8)}`);
  fs.mkdirSync(workDir, { recursive: true });
  try {
    const schemaPath = path.join(workDir, 'review-schema.json');
    fs.writeFileSync(schemaPath, JSON.stringify(REVIEW_SCHEMA, null, 2));

    const prompt = [
      `You are the independent AI-to-AI Code Reviewer for Slice ${slice.id} (${slice.name}) of the Hebrew RTL Family Cookbook native app.`,
      'IMPORTANT: Do NOT call any tools, do NOT read files on disk, and do NOT run shell commands. Everything you need is provided inline below. Respond immediately in a single turn with strict JSON.',
      'NOTE: The mobile app intentionally uses the Firebase JS SDK v11 cleanly isolated inside `apps/mobile/src/services/_firebase/*` (same two-tier isolation invariant INV-P0-04) and `expo-notifications` / `Animated` native driver so Expo SDK 53 builds cleanly on Android and $0 iOS Simulator without CocoaPods static-framework conflicts.',
      'Flag ONLY genuine P0/P1 behavioral bugs, RTL breaks, two-tier Firebase leaks outside src/services/, missing Storage metadata.uploadedBy, Sentry PII leaks, or missing required testIDs as blockingIssues.',
      'Return approved=true if there are zero P0/P1 blocking issues.',
      `\n=== GLOBAL INVARIANTS ===\n${invText.slice(0, 10000)}`,
      `\n=== SLICE ${slice.id} NLSPEC ===\n${specText.slice(0, 18000)}`,
      `\n=== SLICE CODE CHANGES ===\n${codeEvidence}`,
      '\nReturn strictly valid JSON conforming to the provided schema.',
    ].join('\n');

    const agyBin = resolveAgyBinary();
    const t0 = Date.now();
    const proc = await new Promise((resolve, reject) => {
      const child = spawn(
        agyBin,
        [
          '--sandbox',
          '--dangerously-skip-permissions',
          '--disable-slash-commands',
          '--model',
          model,
          '--output-format',
          'json',
          '--json-schema',
          schemaPath,
          '--print-timeout',
          `${timeoutSec}s`,
          '--print',
          prompt,
        ],
        { cwd: workDir, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c) => {
        stdout += c.toString('utf8');
      });
      child.stderr.on('data', (c) => {
        stderr += c.toString('utf8');
      });
      child.once('error', reject);
      child.once('exit', (code) => resolve({ status: code ?? 1, stdout, stderr }));
    });

    if (proc.status !== 0) {
      throw new Error(
        `agy reviewer exited with code ${proc.status}: ${(proc.stderr || proc.stdout).slice(0, 600)}`,
      );
    }

    const envelope = JSON.parse(proc.stdout.trim());
    const result = envelope.structured_output || JSON.parse(envelope.response);
    return { ...result, model, durationMs: Date.now() - t0 };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sliceId =
    process.argv.find((a) => a.startsWith('--slice='))?.slice('--slice='.length) || '00';
  const model = process.argv.find((a) => a.startsWith('--model='))?.slice('--model='.length);
  reviewSlice({ sliceId, ...(model ? { model } : {}) })
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.approved ? 0 : 1);
    })
    .catch((err) => {
      console.error('[reviewer] fatal:', err);
      process.exit(1);
    });
}
