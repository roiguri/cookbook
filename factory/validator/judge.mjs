/**
 * Multimodal LLM-as-a-Judge Runner (powered by authenticated `agy` CLI).
 *
 * Evaluates captured trajectory bundles (screenshots, accessibility hierarchy,
 * Firestore/Storage before/after diffs, Sentry telemetry, and Maestro trace)
 * using a distinct multimodal model via `agy --print --output-format json
 * --json-schema factory/validator/schema.json` in an isolated temp sandbox dir.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateDeterministicInvariants } from './invariant-checker.mjs';
import { synthesizeSanitizedTickets } from './sanitizer.mjs';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = path.join(THIS_DIR, 'schema.json');

export const DIMENSION_WEIGHTS = Object.freeze({
  functionalIntent: 0.4,
  backendIntegrity: 0.25,
  rtlVisualFidelity: 0.25,
  uxStability: 0.1,
});

export const DEFAULT_CONVERGENCE_THRESHOLD = 95;

export function resolveAgyBinary() {
  const candidates = [process.env.AGY_BIN, path.join(os.homedir(), '.local/bin/agy'), 'agy'].filter(
    Boolean,
  );
  for (const c of candidates) {
    if (c === 'agy' || fs.existsSync(c)) return c;
  }
  return 'agy';
}

/**
 * Select a multimodal judge model guaranteed to differ from the builder model.
 */
export function resolveJudgeModel({
  judgeModel = process.env.FACTORY_JUDGE_MODEL || '',
  builderModel = process.env.FACTORY_BUILDER_MODEL || '',
  fast = process.env.FACTORY_JUDGE_FAST === 'true',
} = {}) {
  const preferred = judgeModel || (fast ? 'gemini-3.8-flash-medium' : 'gemini-4-neon-medium');
  if (builderModel && preferred === builderModel) {
    return preferred.startsWith('claude-') ? 'gemini-4-neon-medium' : 'claude-sonnet-5-5-medium';
  }
  return preferred;
}

/**
 * Exact weighted satisfaction score (0..100, rounded to 2 decimal places).
 */
export function computeWeightedScore(dimensions = {}) {
  const score =
    Number(dimensions.functionalIntent || 0) * DIMENSION_WEIGHTS.functionalIntent +
    Number(dimensions.backendIntegrity || 0) * DIMENSION_WEIGHTS.backendIntegrity +
    Number(dimensions.rtlVisualFidelity || 0) * DIMENSION_WEIGHTS.rtlVisualFidelity +
    Number(dimensions.uxStability || 0) * DIMENSION_WEIGHTS.uxStability;
  return Math.round(Math.max(0, Math.min(100, score)) * 100) / 100;
}

/**
 * Aggregate multiple scenario judgments against the release convergence gate:
 *   - Aggregate weighted satisfaction >= threshold (default 95%)
 *   - 0 P0 violations across all trajectories (100% P0 invariant pass)
 */
export function evaluateConvergence(
  judgments = [],
  { threshold = DEFAULT_CONVERGENCE_THRESHOLD } = {},
) {
  if (!judgments.length) {
    return {
      converged: false,
      aggregateScore: 0,
      threshold,
      totalScenarios: 0,
      passedScenarios: 0,
      p0ViolationCount: 0,
    };
  }

  const totalScore = judgments.reduce((sum, j) => sum + Number(j.weightedScore || 0), 0);
  const aggregateScore = Math.round((totalScore / judgments.length) * 100) / 100;
  const p0ViolationCount = judgments.filter((j) => j.p0Violation).length;
  const passedScenarios = judgments.filter((j) => j.passed && !j.p0Violation).length;

  return {
    converged: aggregateScore >= threshold && p0ViolationCount === 0,
    aggregateScore,
    threshold,
    totalScenarios: judgments.length,
    passedScenarios,
    p0ViolationCount,
  };
}

/**
 * Merge deterministic invariant failures into the LLM judgment so hard P0/P1
 * backend/security/math violations can never be smoothed over by an LLM.
 */
export function reconcileJudgment(llmResult, deterministic, trajectory) {
  const mergedFindings = Array.isArray(llmResult.findings) ? [...llmResult.findings] : [];

  for (const v of deterministic.allViolations) {
    mergedFindings.push({
      severity: v.severity,
      domain: v.domain,
      route: trajectory.route || '/home',
      role: trajectory.role || 'approved',
      symptom: v.symptom,
      evidence: v.evidence,
    });
  }

  const dimensions = {
    functionalIntent: Number(llmResult.dimensions?.functionalIntent ?? 0),
    backendIntegrity: Number(llmResult.dimensions?.backendIntegrity ?? 0),
    rtlVisualFidelity: Number(llmResult.dimensions?.rtlVisualFidelity ?? 0),
    uxStability: Number(llmResult.dimensions?.uxStability ?? 0),
  };

  // Clamp affected dimension scores deterministically when hard invariants fail
  for (const v of deterministic.allViolations) {
    if (
      [
        'storage',
        'avatar',
        'observability',
        'manager-dashboard',
        'backend-post-assertion',
      ].includes(v.domain)
    ) {
      dimensions.backendIntegrity = Math.min(
        dimensions.backendIntegrity,
        v.severity === 'P0' ? 0 : 40,
      );
    }
    if (v.domain === 'rtl-layout') {
      dimensions.rtlVisualFidelity = Math.min(dimensions.rtlVisualFidelity, 15);
    }
    if (v.domain === 'recipe-scaling') {
      dimensions.functionalIntent = Math.min(dimensions.functionalIntent, 35);
    }
    if (v.domain === 'stability') {
      dimensions.uxStability = 0;
    }
  }

  if (llmResult.visualAssessment && llmResult.visualAssessment.isRtlCorrect === false) {
    dimensions.rtlVisualFidelity = Math.min(dimensions.rtlVisualFidelity, 20);
  }

  const hasP0Finding = mergedFindings.some((f) => f.severity === 'P0');
  const p0Violation = Boolean(
    llmResult.p0Violation ||
    !deterministic.p0Passed ||
    hasP0Finding ||
    llmResult.visualAssessment?.isRtlCorrect === false,
  );
  const weightedScore = computeWeightedScore(dimensions);
  const passed =
    !p0Violation &&
    deterministic.ok &&
    weightedScore >= DEFAULT_CONVERGENCE_THRESHOLD &&
    Boolean(llmResult.passed);

  return {
    ...llmResult,
    scenarioId: trajectory.scenarioId || llmResult.scenarioId,
    platform: trajectory.platform || llmResult.platform || 'android',
    dimensions,
    weightedScore,
    p0Violation,
    passed,
    findings: mergedFindings,
    deterministicSummary: {
      ok: deterministic.ok,
      p0Passed: deterministic.p0Passed,
      violationCount: deterministic.allViolations.length,
    },
  };
}

/**
 * Judge a single executed trajectory using deterministic invariant checks plus
 * multimodal `agy` CLI visual/behavioral evaluation in an isolated temp sandbox.
 */
export async function judgeTrajectory(
  trajectory,
  {
    rubricText = '',
    model = resolveJudgeModel(),
    timeoutSec = 150,
    deterministicOnly = false,
  } = {},
) {
  const deterministic = evaluateDeterministicInvariants(trajectory);

  if (deterministicOnly) {
    const synthetic = {
      scenarioId: trajectory.scenarioId || 'unknown',
      platform: trajectory.platform || 'android',
      passed: deterministic.ok,
      p0Violation: !deterministic.p0Passed,
      dimensions: {
        functionalIntent: deterministic.ok ? 100 : 50,
        backendIntegrity: deterministic.p0Passed ? 100 : 0,
        rtlVisualFidelity: deterministic.allViolations.some((v) => v.domain === 'rtl-layout')
          ? 10
          : 100,
        uxStability: deterministic.allViolations.some((v) => v.domain === 'stability') ? 0 : 100,
      },
      weightedScore: 100,
      visualAssessment: {
        isRtlCorrect: !deterministic.allViolations.some((v) => v.domain === 'rtl-layout'),
        paletteConsistent: true,
        hasClippedHebrew: false,
        notes: 'Deterministic-only mode (LLM skipped).',
      },
      findings: [],
      rationale: deterministic.ok
        ? 'All deterministic invariants passed.'
        : `Deterministic invariants flagged ${deterministic.allViolations.length} issue(s).`,
    };
    const reconciled = reconcileJudgment(synthetic, deterministic, trajectory);
    const tickets = synthesizeSanitizedTickets(reconciled, {
      screenshotRef: trajectory.screenshots?.[0] || null,
      logExcerpt: trajectory.runtimeLogs || '',
    });
    return { judgment: reconciled, tickets, model: 'deterministic-only', durationMs: 0 };
  }

  // Isolate ONLY the trajectory artifacts inside a fresh temp directory so the
  // Judge has multimodal vision access to screenshots and ZERO access to source code.
  const workDir = path.join(os.tmpdir(), `cookbook-judge-${crypto.randomUUID().slice(0, 8)}`);
  fs.mkdirSync(workDir, { recursive: true });

  try {
    const existingShots = (trajectory.screenshots || []).filter((src) => src && fs.existsSync(src));
    // Keep at most 3 high-signal screenshots (first, penultimate/failure, final-screen.png)
    // so multimodal judging stays fast and never hits CLI print timeouts.
    const selectedShots =
      existingShots.length <= 3
        ? existingShots
        : [
            existingShots[0],
            existingShots[Math.floor(existingShots.length / 2)],
            existingShots[existingShots.length - 1],
          ];
    const copiedScreenshots = [];
    for (let i = 0; i < selectedShots.length; i++) {
      const src = selectedShots[i];
      const dest = path.join(workDir, `step-${i + 1}${path.extname(src) || '.png'}`);
      fs.copyFileSync(src, dest);
      copiedScreenshots.push(dest);
    }

    const trajectoryPayload = JSON.stringify(
      {
        scenarioId: trajectory.scenarioId,
        title: trajectory.title || '',
        platform: trajectory.platform || 'android',
        route: trajectory.route || '/home',
        role: trajectory.role || 'approved',
        userGoal: trajectory.userGoal || '',
        maestroStatus: trajectory.maestroStatus || 'passed',
        hierarchy: trajectory.hierarchy || {},
        snapshotDiff: deterministic.snapshotDiff,
        sentryEvents: trajectory.sentryEvents || [],
        scalingObservations: trajectory.scalingObservations || [],
        deterministicViolations: deterministic.allViolations,
        runtimeLogTail: String(trajectory.runtimeLogs || '').slice(-1500),
      },
      null,
      2,
    );

    const schemaCopy = path.join(workDir, 'schema.json');
    fs.copyFileSync(SCHEMA_PATH, schemaCopy);

    const screenshotInstructions = copiedScreenshots.length
      ? `First, read and visually inspect ONLY these screenshot file(s) using your file-reading tool: ${copiedScreenshots.join(', ')}. Do NOT run any shell commands or inspect any other files.`
      : 'No screenshots were attached; do NOT call any tools or run commands — evaluate strictly from the structured trajectory evidence below.';

    const prompt = [
      'You are the independent Multimodal QA Judge for the Hebrew RTL Family Cookbook native mobile app.',
      screenshotInstructions,
      '',
      'Evaluate strictly on a 0-100 integer scale (e.g. 98, NOT 0.98) across 4 weighted dimensions:',
      '1. functionalIntent (40%): Did the real user goal succeed end-to-end with accurate calculations and state transitions?',
      '2. backendIntegrity (25%): Are Firestore docs, Storage uploadedBy metadata, security rules, and Sentry zero-PII invariants intact?',
      '3. rtlVisualFidelity (25%): Is the UI genuinely right-aligned Hebrew RTL (warm cream #faf6ec surface, #6a994e green / #bc4749 red accents, right-aligned headings/cards, no clipped Hebrew text, no LTR-flipped layout)?',
      '4. uxStability (10%): Clean loading/feedback states, zero crashes, responsive navigation.',
      '',
      'P0 Invariant Rules (ANY violation requires p0Violation=true and passed=false):',
      '- Hebrew RTL flipped to LTR (left-aligned headings/text or RTL=off) -> P0.',
      '- Storage upload missing metadata.uploadedBy or avatar >= 200KB -> P0.',
      '- Sentry telemetry containing PII (email, fullName, search query, API token, sendDefaultPii=true) -> P0.',
      '- Submission rejected with empty rejectionReason or silent no-op -> P0.',
      '- Fatal JS/native crash or unauthorized role bypass -> P0.',
      '',
      'If ALL checks pass cleanly with zero violations and accurate RTL/tokens, return passed=true, p0Violation=false, high scores (95-100), and findings=[].',
      rubricText ? `\nDomain Rubric:\n${rubricText}` : '',
      `\nStructured Trajectory Evidence:\n${trajectoryPayload}`,
      '',
      'CRITICAL: In findings[].symptom and rationale, describe ONLY observable user-facing symptoms, platform, route, role, and data invariants. NEVER mention file paths, YAML commands, emails, tokens, or rubric names.',
      'Return strictly valid JSON conforming to the provided JSON Schema.',
    ].join('\n');

    const t0 = Date.now();
    const agyBin = resolveAgyBinary();
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
          schemaCopy,
          '--print-timeout',
          `${timeoutSec}s`,
          '--print',
          prompt,
        ],
        {
          cwd: workDir,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
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
    const durationMs = Date.now() - t0;

    if (proc.status !== 0) {
      throw new Error(
        `agy judge exited with code ${proc.status}: ${(proc.stderr || proc.stdout || '').slice(0, 800)}`,
      );
    }

    const envelope = JSON.parse(proc.stdout.trim());
    const parsed = envelope.structured_output || JSON.parse(envelope.response);
    const reconciled = reconcileJudgment(parsed, deterministic, trajectory);
    const tickets = synthesizeSanitizedTickets(reconciled, {
      screenshotRef: trajectory.screenshots?.[0] || null,
      logExcerpt: trajectory.runtimeLogs || '',
    });

    return {
      judgment: reconciled,
      tickets,
      model,
      durationMs,
      usage: envelope.usage || null,
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
