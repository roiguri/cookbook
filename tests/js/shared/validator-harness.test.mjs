import {
  checkNativeCrashes,
  checkRtlHierarchy,
  checkSentryPrivacy,
  checkServingScaling,
  checkStorageUploadedBy,
  checkSubmissionRejectionIntegrity,
  diffSnapshots,
  evaluateDeterministicInvariants,
} from '../../../factory/validator/invariant-checker.mjs';
import {
  assertZeroHoldoutLeakage,
  redactText,
  synthesizeSanitizedTickets,
} from '../../../factory/validator/sanitizer.mjs';
import {
  computeWeightedScore,
  evaluateConvergence,
  reconcileJudgment,
  resolveJudgeModel,
} from '../../../factory/validator/judge.mjs';
import { runMutationCalibration } from '../../../factory/validator/calibrate-mutations.mjs';

describe('Software Factory Validator & Multimodal Judge Harness', () => {
  test('computeWeightedScore applies exact 40/25/25/10 dimension weights', () => {
    expect(
      computeWeightedScore({
        functionalIntent: 100,
        backendIntegrity: 100,
        rtlVisualFidelity: 100,
        uxStability: 100,
      }),
    ).toBe(100);
    expect(
      computeWeightedScore({
        functionalIntent: 90,
        backendIntegrity: 100,
        rtlVisualFidelity: 80,
        uxStability: 100,
      }),
    ).toBe(91);
  });

  test('resolveJudgeModel guarantees distinct model when builder model matches default', () => {
    expect(
      resolveJudgeModel({
        judgeModel: 'gemini-4-neon-medium',
        builderModel: 'gemini-4-neon-medium',
      }),
    ).toBe('claude-sonnet-5-5-medium');
    expect(
      resolveJudgeModel({
        judgeModel: 'claude-sonnet-5-5-medium',
        builderModel: 'claude-sonnet-5-5-medium',
      }),
    ).toBe('gemini-4-neon-medium');
  });

  test('evaluateConvergence enforces >= 95% satisfaction AND 0 P0 violations', () => {
    const clean = evaluateConvergence([
      { passed: true, p0Violation: false, weightedScore: 98 },
      { passed: true, p0Violation: false, weightedScore: 95 },
    ]);
    expect(clean.converged).toBe(true);
    expect(clean.aggregateScore).toBe(96.5);

    const p0Blocked = evaluateConvergence([
      { passed: true, p0Violation: false, weightedScore: 100 },
      { passed: false, p0Violation: true, weightedScore: 92 },
    ]);
    expect(p0Blocked.converged).toBe(false);
    expect(p0Blocked.p0ViolationCount).toBe(1);
  });

  test('deterministic invariants catch all 5 P0/P1 mutation classes', () => {
    // 1. RTL break
    expect(checkRtlHierarchy({ isRTL: false, layoutDirection: 'ltr', nodes: [] })).toHaveLength(1);

    // 2. Missing uploadedBy & oversized avatar
    const storageDiff = diffSnapshots(
      { storage: [] },
      {
        storage: [
          { name: 'recipes/r1/images/a.jpg', contentType: 'image/jpeg', size: 1000, metadata: {} },
          {
            name: 'recipes/r1/images/a_400x400.webp',
            contentType: 'image/webp',
            size: 500,
            metadata: {},
          },
          {
            name: 'user-avatars/u1.png',
            contentType: 'image/png',
            size: 250000,
            metadata: { uploadedBy: 'u2' },
          },
        ],
      },
    ).storage;
    const storageViolations = checkStorageUploadedBy(storageDiff);
    expect(storageViolations.length).toBeGreaterThanOrEqual(3);

    // 3. Serving fraction math
    expect(
      checkServingScaling([
        {
          item: 'סוכר',
          originalAmount: 0.5,
          originalServings: 4,
          targetServings: 6,
          displayedAmount: '3/4',
        },
      ]),
    ).toHaveLength(0);
    expect(
      checkServingScaling([
        {
          item: 'סוכר',
          originalAmount: 0.5,
          originalServings: 4,
          targetServings: 6,
          displayedAmount: '0.5',
        },
      ]),
    ).toHaveLength(1);

    // 4. Sentry PII & token leak
    const piiViolations = checkSentryPrivacy([
      {
        sendDefaultPii: true,
        user: { id: 'u1', email: 'family@cookbook.test' },
        extra: { searchQuery: 'חלה', token: 'cbk_secretToken123456' },
      },
    ]);
    expect(piiViolations.length).toBeGreaterThanOrEqual(4);

    // 5. Empty submission rejection reason + crash log
    const rejDiff = diffSnapshots(
      { firestore: { 'recipe_submissions/r1': { status: 'pending', rejectionReason: null } } },
      { firestore: { 'recipe_submissions/r1': { status: 'rejected', rejectionReason: '  ' } } },
    ).firestore;
    expect(checkSubmissionRejectionIntegrity(rejDiff)).toHaveLength(1);
    expect(checkNativeCrashes('Fatal signal 6 (SIGABRT) in tid 12')).toHaveLength(1);
  });

  test('sanitizer strips all holdout paths, YAML commands, emails, and API tokens', () => {
    const raw =
      'Failed in .factory-holdout/scenarios/suite-i-dashboard/I03.yml at assertVisible: "foo" for family@cookbook.test token cbk_1234567890abcd';
    const cleaned = redactText(raw);
    expect(cleaned).not.toContain('.factory-holdout');
    expect(cleaned).not.toContain('suite-i-dashboard');
    expect(cleaned).not.toContain('assertVisible');
    expect(cleaned).not.toContain('family@cookbook.test');
    expect(cleaned).not.toContain('cbk_1234567890abcd');

    const tickets = synthesizeSanitizedTickets({
      platform: 'android',
      passed: false,
      p0Violation: true,
      findings: [
        {
          severity: 'P0',
          domain: 'manager-dashboard',
          route: '/dashboard',
          role: 'manager',
          symptom: raw,
          evidence: 'rubrics/suite-i-dashboard.md',
        },
      ],
    });
    expect(tickets).toHaveLength(1);
    expect(assertZeroHoldoutLeakage(tickets)).toBe(true);
  });

  test('reconcileJudgment overrides overly generous LLM pass when deterministic P0 fails', () => {
    const det = evaluateDeterministicInvariants({
      hierarchy: { isRTL: false, layoutDirection: 'ltr' },
    });
    const reconciled = reconcileJudgment(
      {
        scenarioId: 'X1',
        platform: 'android',
        passed: true,
        p0Violation: false,
        dimensions: {
          functionalIntent: 100,
          backendIntegrity: 100,
          rtlVisualFidelity: 100,
          uxStability: 100,
        },
        weightedScore: 100,
        visualAssessment: {
          isRtlCorrect: true,
          paletteConsistent: true,
          hasClippedHebrew: false,
          notes: '',
        },
        findings: [],
        rationale: 'Looks fine',
      },
      det,
      { scenarioId: 'X1', platform: 'android', route: '/home', role: 'guest' },
    );
    expect(reconciled.passed).toBe(false);
    expect(reconciled.p0Violation).toBe(true);
    expect(reconciled.dimensions.rtlVisualFidelity).toBeLessThanOrEqual(15);
  });

  test('deterministic mutation calibration detects 5/5 faults and passes clean control', async () => {
    const res = await runMutationCalibration({ deterministicOnly: true });
    expect(res.ok).toBe(true);
    expect(res.controlPassed).toBe(true);
    expect(res.mutationsCaught).toBe(5);
    expect(res.totalMutations).toBe(5);
  });
});
