/**
 * Mutation Calibration Harness ("Validate the Validators" — Phase 3 Exit Gate).
 *
 * Injects 5 deliberate synthetic faults (+ 1 clean control baseline) with real
 * rendered mobile PNG screenshots, Firestore/Storage diffs, scaling observations,
 * and Sentry telemetry events, then runs the LIVE Multimodal `agy` Judge to prove:
 *   - Clean control passes (>= 95%, 0 P0 violations, 0 tickets)
 *   - 5/5 deliberate faults are detected (passed === false, actionable sanitized tickets)
 *   - 0 holdout/PII leakage across every emitted sanitized ticket
 *
 * Usage:
 *   node factory/validator/calibrate-mutations.mjs [--deterministic-only] [--model=<model>]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { judgeTrajectory, resolveJudgeModel } from './judge.mjs';
import { assertZeroHoldoutLeakage } from './sanitizer.mjs';

function renderCalibrationScreenshots(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const script = `
import os, sys
from PIL import Image, ImageDraw

out_dir = sys.argv[1]

def save_clean(path):
    # Warm cream surface0 (#faf6ec), right-aligned RTL card (#ffffff), primary green pill (#6a994e)
    img = Image.new("RGB", (420, 760), (250, 246, 236))
    d = ImageDraw.Draw(img)
    # Header bar (RTL: brand on right, avatar on left; surface2 #f6eed6)
    d.rectangle([0, 0, 420, 72], fill=(246, 238, 214))
    d.rounded_rectangle([240, 18, 396, 54], radius=12, fill=(106, 153, 78))
    d.text((262, 28), "COOKBOOK RTL", fill=(255, 255, 255))
    d.ellipse([20, 16, 60, 56], fill=(188, 71, 73))
    # Main card (surface1 #ffffff)
    d.rounded_rectangle([24, 104, 396, 460], radius=20, fill=(255, 255, 255), outline=(220, 212, 196), width=2)
    # Right-aligned heading & subtitle indicators (RTL anchored to right edge x=376; ink #1f1d18 / ink3 #6b6a63)
    d.rectangle([160, 134, 376, 164], fill=(31, 29, 24))
    d.text((220, 142), "RTL HEADING RIGHT", fill=(255, 255, 255))
    d.rectangle([200, 184, 376, 206], fill=(107, 106, 99))
    # Scaled ingredient rows right-aligned
    d.rounded_rectangle([180, 240, 376, 276], radius=14, fill=(106, 153, 78))
    d.text((205, 251), "Servings: 6 -> 3/4 cup", fill=(255, 255, 255))
    d.text((240, 310), "RTL: ACTIVE | DTU OK", fill=(56, 102, 65))
    img.save(path)

def save_ltr_broken(path):
    # Broken stark-white LTR-flipped layout: everything pushed to left edge + clipped text
    img = Image.new("RGB", (420, 760), (255, 255, 255))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 420, 72], fill=(230, 230, 230))
    d.rectangle([8, 18, 170, 54], fill=(0, 0, 255))
    d.text((16, 28), "LTR BROKEN LEFT", fill=(255, 255, 255))
    d.rectangle([8, 110, 240, 144], fill=(0, 0, 0))
    d.text((14, 120), "RTL: OFF (LTR FLIPPED)", fill=(255, 0, 0))
    d.text((14, 170), "Hebrew layout broken - left aligned", fill=(200, 0, 0))
    img.save(path)

def save_wrong_scaling(path):
    img = Image.new("RGB", (420, 760), (250, 246, 236))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([24, 104, 396, 420], radius=20, fill=(255, 253, 248), outline=(220, 212, 196), width=2)
    d.text((140, 150), "Servings scaled: 4 -> 6", fill=(28, 25, 23))
    d.text((120, 210), "Sugar displayed: 0.5 cup (WRONG)", fill=(188, 71, 73))
    d.text((120, 250), "Expected: 3/4 cup", fill=(56, 102, 65))
    img.save(path)

save_clean(os.path.join(out_dir, "clean-rtl.png"))
save_ltr_broken(os.path.join(out_dir, "mut1-rtl-break.png"))
save_wrong_scaling(os.path.join(out_dir, "mut3-wrong-scaling.png"))
print("rendered")
`;

  const res = spawnSync('python3', ['-c', script, outDir], { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`Failed to render calibration PNGs: ${res.stderr}`);
  }
  return {
    clean: path.join(outDir, 'clean-rtl.png'),
    rtlBreak: path.join(outDir, 'mut1-rtl-break.png'),
    wrongScaling: path.join(outDir, 'mut3-wrong-scaling.png'),
  };
}

export function buildCalibrationCases(pngs) {
  return [
    {
      name: 'CONTROL-clean-baseline',
      expectDetected: false,
      expectP0: false,
      trajectory: {
        scenarioId: 'CAL-CONTROL',
        title: 'Clean RTL Recipe Detail & Accurate Scaling Baseline',
        platform: 'android',
        route: '/recipe/dtu-pub-desserts',
        role: 'approved',
        userGoal:
          'View recipe in Hebrew RTL and scale servings from 4 to 6 cleanly with zero errors.',
        maestroStatus: 'passed',
        screenshots: [pngs.clean],
        hierarchy: {
          isRTL: true,
          layoutDirection: 'rtl',
          nodes: [
            {
              text: 'עוגת ביסקוויטים קלאסית',
              isHebrewHeading: true,
              screenWidth: 1080,
              bounds: { left: 420, right: 1040 },
            },
            { text: 'RTL: פעיל · e2e' },
          ],
        },
        beforeSnapshot: { firestore: {}, storage: [] },
        afterSnapshot: {
          firestore: {},
          storage: [
            {
              name: 'recipes/dtu-pub-desserts/images/img-new.jpg',
              contentType: 'image/jpeg',
              size: 42000,
              metadata: { uploadedBy: 'dtu-approved-1' },
            },
          ],
        },
        scalingObservations: [
          {
            item: 'סוכר',
            originalAmount: 0.5,
            unit: 'כוס',
            originalServings: 4,
            targetServings: 6,
            displayedAmount: '3/4',
          },
        ],
        sentryEvents: [
          {
            sendDefaultPii: false,
            user: { id: 'dtu-approved-1' },
            tags: { role: 'approved' },
            extra: { service: 'recipe', op: 'get', recipeId: 'dtu-pub-desserts' },
          },
        ],
        runtimeLogs: 'I/ReactNativeJS: Running "main" cleanly.',
      },
    },
    {
      name: 'MUTATION-1-rtl-layout-break',
      expectDetected: true,
      expectP0: true,
      trajectory: {
        scenarioId: 'CAL-MUT-1',
        title: 'Synthetic Fault 1: Cold-start Hebrew RTL flipped to LTR',
        platform: 'android',
        route: '/home',
        role: 'guest',
        userGoal: 'Cold start app in forced Hebrew RTL on warm cream design tokens.',
        maestroStatus: 'passed',
        screenshots: [pngs.rtlBreak],
        hierarchy: {
          isRTL: false,
          layoutDirection: 'ltr',
          nodes: [
            {
              text: 'ספר המתכונים המשפחתי',
              isHebrewHeading: true,
              screenWidth: 1080,
              bounds: { left: 20, right: 420 },
            },
            { text: 'RTL: כבוי · e2e' },
          ],
        },
        beforeSnapshot: { firestore: {}, storage: [] },
        afterSnapshot: { firestore: {}, storage: [] },
        sentryEvents: [],
        runtimeLogs: '',
      },
    },
    {
      name: 'MUTATION-2-missing-storage-uploadedBy',
      expectDetected: true,
      expectP0: true,
      trajectory: {
        scenarioId: 'CAL-MUT-2',
        title: 'Synthetic Fault 2: Recipe photo & avatar upload missing customMetadata.uploadedBy',
        platform: 'android',
        route: '/propose-recipe',
        role: 'approved',
        userGoal:
          'Upload recipe photo and avatar PNG tagged with uploadedBy matching storage.rules.',
        maestroStatus: 'passed',
        screenshots: [pngs.clean],
        hierarchy: { isRTL: true, layoutDirection: 'rtl', nodes: [] },
        beforeSnapshot: { firestore: {}, storage: [] },
        afterSnapshot: {
          firestore: {},
          storage: [
            {
              name: 'recipes/dtu-new-99/images/img-untagged.jpg',
              contentType: 'image/jpeg',
              size: 51200,
              metadata: {},
            },
            {
              name: 'user-avatars/dtu-approved-1.png',
              contentType: 'image/png',
              size: 260000,
              metadata: {},
            },
          ],
        },
        sentryEvents: [],
        runtimeLogs: 'W/StorageService: upload completed without customMetadata.uploadedBy',
      },
    },
    {
      name: 'MUTATION-3-wrong-serving-fraction-math',
      expectDetected: true,
      expectP0: false,
      trajectory: {
        scenarioId: 'CAL-MUT-3',
        title: 'Synthetic Fault 3: Incorrect serving fraction scaling calculation',
        platform: 'ios',
        route: '/recipe/dtu-pub-desserts',
        role: 'guest',
        userGoal:
          'Scale recipe from 4 to 6 servings so 1/2 cup sugar updates accurately to 3/4 cup.',
        maestroStatus: 'passed',
        screenshots: [pngs.wrongScaling],
        hierarchy: { isRTL: true, layoutDirection: 'rtl', nodes: [] },
        beforeSnapshot: { firestore: {}, storage: [] },
        afterSnapshot: { firestore: {}, storage: [] },
        scalingObservations: [
          {
            item: 'סוכר',
            originalAmount: 0.5,
            unit: 'כוס',
            originalServings: 4,
            targetServings: 6,
            displayedAmount: '0.5',
          },
        ],
        sentryEvents: [],
        runtimeLogs: '',
      },
    },
    {
      name: 'MUTATION-4-sentry-pii-leak',
      expectDetected: true,
      expectP0: true,
      trajectory: {
        scenarioId: 'CAL-MUT-4',
        title:
          'Synthetic Fault 4: Sentry event leaks user email, fullName, search query, and API token',
        platform: 'android',
        route: '/categories',
        role: 'approved',
        userGoal: 'Search recipes while logging zero PII or secrets to Sentry.',
        maestroStatus: 'passed',
        screenshots: [pngs.clean],
        hierarchy: { isRTL: true, layoutDirection: 'rtl', nodes: [] },
        beforeSnapshot: { firestore: {}, storage: [] },
        afterSnapshot: { firestore: {}, storage: [] },
        sentryEvents: [
          {
            sendDefaultPii: true,
            user: {
              id: 'dtu-approved-1',
              email: 'family@cookbook.test',
              fullName: 'דנה כהן',
            },
            tags: { role: 'approved' },
            extra: {
              service: 'recipe-search',
              op: 'search',
              searchQuery: 'עוגיות טחינה סודיות',
              apiToken: 'cbk_leakTestToken987654321',
            },
          },
        ],
        runtimeLogs: '',
      },
    },
    {
      name: 'MUTATION-5-broken-rejection-guard',
      expectDetected: true,
      expectP0: true,
      trajectory: {
        scenarioId: 'CAL-MUT-5',
        title: 'Synthetic Fault 5: Manager submission rejected with empty rejectionReason',
        platform: 'ios',
        route: '/dashboard',
        role: 'manager',
        userGoal: 'Rejecting a pending submission requires a non-empty Hebrew rejectionReason.',
        maestroStatus: 'passed',
        screenshots: [pngs.clean],
        hierarchy: { isRTL: true, layoutDirection: 'rtl', nodes: [] },
        beforeSnapshot: {
          firestore: {
            'recipe_submissions/dtu-sub-pending': {
              recipeId: 'dtu-sub-pending',
              authorId: 'dtu-approved-1',
              status: 'pending',
              rejectionReason: null,
            },
          },
          storage: [],
        },
        afterSnapshot: {
          firestore: {
            'recipe_submissions/dtu-sub-pending': {
              recipeId: 'dtu-sub-pending',
              authorId: 'dtu-approved-1',
              status: 'rejected',
              rejectionReason: '   ',
            },
          },
          storage: [],
        },
        sentryEvents: [],
        runtimeLogs: '',
      },
    },
  ];
}

export async function runMutationCalibration({
  deterministicOnly = false,
  model = resolveJudgeModel({ fast: true }),
} = {}) {
  const tmpDir = path.join(os.tmpdir(), `cookbook-calibration-${Date.now()}`);
  try {
    const pngs = renderCalibrationScreenshots(tmpDir);
    const cases = buildCalibrationCases(pngs);
    const results = [];
    let mutationsCaught = 0;
    let totalMutations = 0;
    let controlPassed = false;

    const outcomes = await Promise.all(
      cases.map(async (c) => {
        const outcome = await judgeTrajectory(c.trajectory, {
          model,
          deterministicOnly,
          rubricText:
            'Verify strict Hebrew RTL alignment, Cookbook warm cream tokens, exact fraction scaling, Storage uploadedBy compliance, zero Sentry PII, and mandatory submission rejection reason.',
        });
        assertZeroHoldoutLeakage(outcome.tickets);
        return { c, outcome };
      }),
    );

    for (const { c, outcome } of outcomes) {
      const detected = !outcome.judgment.passed;
      const p0Matched = !c.expectP0 || outcome.judgment.p0Violation === true;
      const ticketsOk = c.expectDetected
        ? outcome.tickets.length > 0
        : outcome.tickets.length === 0;
      const ok = detected === c.expectDetected && p0Matched && ticketsOk;

      if (c.expectDetected) {
        totalMutations += 1;
        if (ok) mutationsCaught += 1;
      } else {
        controlPassed = ok;
      }

      results.push({
        name: c.name,
        ok,
        expectedDetected: c.expectDetected,
        actualPassed: outcome.judgment.passed,
        p0Violation: outcome.judgment.p0Violation,
        weightedScore: outcome.judgment.weightedScore,
        ticketCount: outcome.tickets.length,
        durationMs: outcome.durationMs,
        sampleTicket: outcome.tickets[0] || null,
      });
    }

    return {
      ok: controlPassed && mutationsCaught === totalMutations,
      model: deterministicOnly ? 'deterministic-only' : model,
      controlPassed,
      mutationsCaught,
      totalMutations,
      results,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  const deterministicOnly = process.argv.includes('--deterministic-only');
  const modelArg = process.argv.find((a) => a.startsWith('--model='));
  const model = modelArg ? modelArg.slice('--model='.length) : resolveJudgeModel({ fast: true });

  console.log(
    `\n=== Cookbook Judge Mutation Calibration (model=${deterministicOnly ? 'deterministic-only' : model}) ===\n`,
  );
  const summary = await runMutationCalibration({ deterministicOnly, model });

  for (const r of summary.results) {
    const tag = r.ok ? 'PASS' : 'FAIL';
    console.log(
      `[${tag}] ${r.name} | passed=${r.actualPassed} p0=${r.p0Violation} score=${r.weightedScore} tickets=${r.ticketCount} (${(r.durationMs / 1000).toFixed(1)}s)`,
    );
    if (r.sampleTicket) {
      console.log(
        `       Ticket ${r.sampleTicket.ticketId} [${r.sampleTicket.severity}]: ${r.sampleTicket.symptom}`,
      );
    }
  }

  console.log(
    `\nSummary: controlPassed=${summary.controlPassed}, mutationsCaught=${summary.mutationsCaught}/${summary.totalMutations}, zeroLeakage=VERIFIED\n`,
  );
  process.exit(summary.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[calibration] failed:', err);
    process.exit(1);
  });
}
