/**
 * Deterministic P0 & P1 Invariant Verifier for Cookbook Software Factory Trajectories.
 *
 * Runs alongside the Multimodal LLM-as-a-Judge so security, storage metadata,
 * privacy (zero Sentry PII), RTL hierarchy flags, serving fraction math,
 * mandatory rejection reasons, and native crash checks are mathematically exact.
 */
import {
  formatIngredientAmount,
  scaleIngredients,
} from '../../packages/cookbook-core/recipe-utils/recipe-ingredients-utils.js';

const AVATAR_MAX_BYTES = 200 * 1024;
const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const API_TOKEN_REGEX = /\bcbk_[A-Za-z0-9_-]{12,}\b/;
const FORBIDDEN_SENTRY_USER_KEYS = new Set([
  'email',
  'username',
  'fullName',
  'displayName',
  'avatarUrl',
  'ip_address',
]);
const FORBIDDEN_SENTRY_EXTRA_KEYS = new Set([
  'email',
  'password',
  'fullName',
  'displayName',
  'searchQuery',
  'query',
  'recipeName',
  'rawInput',
  'token',
  'apiToken',
  'secret',
]);
const CRASH_PATTERNS = [
  /FATAL EXCEPTION/i,
  /Fatal signal 6 \(SIGABRT\)/i,
  /JavascriptException/i,
  /Unhandled JS Exception/i,
  /EXC_BAD_ACCESS/i,
  /Terminating app due to uncaught exception/i,
  /Cannot find native module/i,
];

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Compute deterministic diff between two DTU `/snapshot` payloads.
 */
export function diffSnapshots(before = {}, after = {}) {
  const beforeFs = before.firestore || {};
  const afterFs = after.firestore || {};

  const firestoreAdded = {};
  const firestoreUpdated = {};
  const firestoreDeleted = [];

  for (const [docPath, docVal] of Object.entries(afterFs)) {
    if (!(docPath in beforeFs)) {
      firestoreAdded[docPath] = docVal;
    } else if (!deepEqual(beforeFs[docPath], docVal)) {
      firestoreUpdated[docPath] = { before: beforeFs[docPath], after: docVal };
    }
  }
  for (const docPath of Object.keys(beforeFs)) {
    if (!(docPath in afterFs)) firestoreDeleted.push(docPath);
  }

  const beforeStorageMap = new Map((before.storage || []).map((f) => [f.name, f]));
  const afterStorageMap = new Map((after.storage || []).map((f) => [f.name, f]));

  const storageAdded = [];
  const storageUpdated = [];
  const storageDeleted = [];

  for (const [name, fileObj] of afterStorageMap.entries()) {
    if (!beforeStorageMap.has(name)) {
      storageAdded.push(fileObj);
    } else if (!deepEqual(beforeStorageMap.get(name), fileObj)) {
      storageUpdated.push({ before: beforeStorageMap.get(name), after: fileObj });
    }
  }
  for (const name of beforeStorageMap.keys()) {
    if (!afterStorageMap.has(name)) storageDeleted.push(name);
  }

  return {
    firestore: {
      added: firestoreAdded,
      updated: firestoreUpdated,
      deleted: firestoreDeleted,
    },
    storage: {
      added: storageAdded,
      updated: storageUpdated,
      deleted: storageDeleted,
    },
  };
}

/**
 * INV-P0-05: Every client-uploaded Storage file MUST carry `metadata.uploadedBy`,
 * and built avatars at `user-avatars/{uid}.png` MUST be PNG < 200 KB tagged to uid.
 */
export function checkStorageUploadedBy(storageDiff = { added: [], updated: [] }) {
  const violations = [];
  const changedFiles = [
    ...(storageDiff.added || []),
    ...(storageDiff.updated || []).map((u) => u.after),
  ];

  for (const file of changedFiles) {
    if (!file || !file.name) continue;
    // Ignore auto-generated resized WebP variants created by resize-twin
    if (/_(400x400|1080x1080)\.webp$/i.test(file.name)) continue;

    const uploadedBy = file.metadata?.uploadedBy;
    if (!uploadedBy || typeof uploadedBy !== 'string' || !uploadedBy.trim()) {
      violations.push({
        invariant: 'INV-P0-05',
        severity: 'P0',
        domain: 'storage',
        symptom: `Uploaded Storage object "${file.name}" is missing required customMetadata.uploadedBy tag.`,
        evidence: JSON.stringify({ name: file.name, metadata: file.metadata || {} }),
      });
    }

    if (file.name.startsWith('user-avatars/')) {
      const expectedUid = file.name.slice('user-avatars/'.length).replace(/\.png$/i, '');
      if (!file.name.endsWith('.png') || file.contentType !== 'image/png') {
        violations.push({
          invariant: 'INV-P0-05',
          severity: 'P0',
          domain: 'avatar',
          symptom: `Avatar upload "${file.name}" must be image/png (got ${file.contentType || 'unknown'}).`,
          evidence: JSON.stringify({ name: file.name, contentType: file.contentType }),
        });
      }
      if (Number(file.size || 0) >= AVATAR_MAX_BYTES) {
        violations.push({
          invariant: 'INV-P0-05',
          severity: 'P0',
          domain: 'avatar',
          symptom: `Avatar upload "${file.name}" exceeds 200 KB cap (${file.size} bytes).`,
          evidence: JSON.stringify({ name: file.name, size: file.size }),
        });
      }
      if (uploadedBy && uploadedBy !== expectedUid) {
        violations.push({
          invariant: 'INV-P0-05',
          severity: 'P0',
          domain: 'avatar',
          symptom: `Avatar upload "${file.name}" uploadedBy ("${uploadedBy}") does not match owner UID ("${expectedUid}").`,
          evidence: JSON.stringify({ name: file.name, uploadedBy, expectedUid }),
        });
      }
    }
  }

  return violations;
}

/**
 * INV-P0-06: Zero PII in Sentry events (UID + role only, no email/name/raw input/tokens).
 */
export function checkSentryPrivacy(sentryEvents = []) {
  const violations = [];
  for (let i = 0; i < sentryEvents.length; i++) {
    const ev = sentryEvents[i] || {};
    if (ev.sendDefaultPii === true) {
      violations.push({
        invariant: 'INV-P0-06',
        severity: 'P0',
        domain: 'observability',
        symptom: 'Sentry client initialized with sendDefaultPii=true (must be false).',
        evidence: `event[${i}].sendDefaultPii=true`,
      });
    }

    if (ev.user && typeof ev.user === 'object') {
      for (const key of Object.keys(ev.user)) {
        if (FORBIDDEN_SENTRY_USER_KEYS.has(key) && ev.user[key]) {
          violations.push({
            invariant: 'INV-P0-06',
            severity: 'P0',
            domain: 'observability',
            symptom: `Sentry user context leaked forbidden PII field "${key}" (only UID is permitted).`,
            evidence: `event[${i}].user.${key} present`,
          });
        }
      }
    }

    if (ev.extra && typeof ev.extra === 'object') {
      for (const [key, val] of Object.entries(ev.extra)) {
        if (
          FORBIDDEN_SENTRY_EXTRA_KEYS.has(key) &&
          val !== undefined &&
          val !== null &&
          val !== ''
        ) {
          violations.push({
            invariant: 'INV-P0-06',
            severity: 'P0',
            domain: 'observability',
            symptom: `Sentry extra context contains forbidden user-content or secret field "${key}".`,
            evidence: `event[${i}].extra.${key} present`,
          });
        }
      }
    }

    const serialized = JSON.stringify({
      user: ev.user,
      extra: ev.extra,
      tags: ev.tags,
      message: ev.message,
    });
    if (EMAIL_REGEX.test(serialized)) {
      violations.push({
        invariant: 'INV-P0-06',
        severity: 'P0',
        domain: 'observability',
        symptom: 'Sentry telemetry event contains an unredacted email address.',
        evidence: `event[${i}] matched email pattern`,
      });
    }
    if (API_TOKEN_REGEX.test(serialized)) {
      violations.push({
        invariant: 'INV-P0-08',
        severity: 'P0',
        domain: 'observability',
        symptom: 'Sentry telemetry event leaked a plaintext Recipe API token.',
        evidence: `event[${i}] matched cbk_* token pattern`,
      });
    }
  }
  return violations;
}

/**
 * INV-P0-07: Submission rejection guard — rejected submissions MUST carry a non-empty
 * `rejectionReason`, and if a test attempted an empty-reason rejection it MUST remain blocked.
 */
export function checkSubmissionRejectionIntegrity(firestoreDiff = {}, expectations = {}) {
  const violations = [];
  const allSubmissions = [
    ...Object.entries(firestoreDiff.added || {}).map(([p, after]) => [p, null, after]),
    ...Object.entries(firestoreDiff.updated || {}).map(([p, pair]) => [p, pair.before, pair.after]),
  ].filter(([docPath]) => docPath.startsWith('recipe_submissions/'));

  for (const [docPath, , after] of allSubmissions) {
    if (after?.status === 'rejected') {
      const reason = typeof after.rejectionReason === 'string' ? after.rejectionReason.trim() : '';
      if (!reason) {
        violations.push({
          invariant: 'INV-P0-07',
          severity: 'P0',
          domain: 'manager-dashboard',
          symptom: `Submission "${docPath}" transitioned to status="rejected" with an empty rejectionReason.`,
          evidence: JSON.stringify({
            docPath,
            status: after.status,
            rejectionReason: after.rejectionReason,
          }),
        });
      }
    }
  }

  // Also catch silent no-op when a valid rejection was expected to succeed
  if (expectations.expectRejectedSubmissionId) {
    const targetPath = `recipe_submissions/${expectations.expectRejectedSubmissionId}`;
    const updated = firestoreDiff.updated?.[targetPath]?.after;
    if (!updated || updated.status !== 'rejected') {
      violations.push({
        invariant: 'INV-P0-07',
        severity: 'P0',
        domain: 'manager-dashboard',
        symptom: `Manager rejection flow did not persist status="rejected" on "${targetPath}" (possible silent button no-op).`,
        evidence: JSON.stringify({ targetPath, afterStatus: updated?.status || 'unchanged' }),
      });
    }
  }

  return violations;
}

/**
 * INV-P0-09: Deterministic RTL hierarchy check (complements multimodal visual inspection).
 */
export function checkRtlHierarchy(hierarchy = {}) {
  const violations = [];
  if (hierarchy.isRTL === false || hierarchy.layoutDirection === 'ltr') {
    violations.push({
      invariant: 'INV-P0-09',
      severity: 'P0',
      domain: 'rtl-layout',
      symptom: 'Application rendered in LTR layout direction instead of forced Hebrew RTL.',
      evidence: JSON.stringify({
        isRTL: hierarchy.isRTL,
        layoutDirection: hierarchy.layoutDirection,
      }),
    });
  }

  const nodes = Array.isArray(hierarchy.nodes) ? hierarchy.nodes : [];
  for (const node of nodes) {
    const text = String(node.text || '');
    if (text.includes('RTL: כבוי')) {
      violations.push({
        invariant: 'INV-P0-09',
        severity: 'P0',
        domain: 'rtl-layout',
        symptom: 'Cold-start RTL indicator reported RTL inactive ("RTL: כבוי").',
        evidence: text,
      });
    }
    if (
      node.isHebrewHeading &&
      node.screenWidth > 0 &&
      node.bounds &&
      node.bounds.left < node.screenWidth * 0.15 &&
      node.bounds.right < node.screenWidth * 0.65
    ) {
      violations.push({
        invariant: 'INV-P0-09',
        severity: 'P0',
        domain: 'rtl-layout',
        symptom: `Hebrew heading "${text}" is anchored to the left edge instead of right-aligned RTL.`,
        evidence: JSON.stringify({ text, bounds: node.bounds, screenWidth: node.screenWidth }),
      });
    }
  }

  return violations;
}

/**
 * INV-P1-02 (calibrated): Verify scaled ingredient display matches `@cookbook/core`
 * `scaleIngredients` + `formatIngredientAmount` verbatim.
 */
export function checkServingScaling(observations = []) {
  const violations = [];
  for (const obs of observations) {
    const scaled = scaleIngredients(
      [{ item: obs.item || 'מרכיב', amount: obs.originalAmount, unit: obs.unit || '' }],
      obs.originalServings,
      obs.targetServings,
    );
    const expected = formatIngredientAmount(scaled[0].amount);
    const actual = String(obs.displayedAmount ?? '').trim();
    if (expected !== actual) {
      violations.push({
        invariant: 'INV-P1-02',
        severity: 'P1',
        domain: 'recipe-scaling',
        symptom: `Scaled amount for "${obs.item || 'ingredient'}" (${obs.originalServings} -> ${obs.targetServings} servings) displayed "${actual}" instead of expected "${expected}".`,
        evidence: JSON.stringify({
          originalAmount: obs.originalAmount,
          originalServings: obs.originalServings,
          targetServings: obs.targetServings,
          expected,
          actual,
        }),
      });
    }
  }
  return violations;
}

/**
 * INV-P0-10: Zero fatal native or JS crashes in runtime logs.
 */
export function checkNativeCrashes(logText = '') {
  const violations = [];
  if (!logText) return violations;
  for (const pattern of CRASH_PATTERNS) {
    const match = logText.match(pattern);
    if (match) {
      violations.push({
        invariant: 'INV-P0-10',
        severity: 'P0',
        domain: 'stability',
        symptom: `Runtime log captured fatal error matching ${match[0]}.`,
        evidence: match[0],
      });
    }
  }
  return violations;
}

/**
 * Run all deterministic invariant checks over a captured scenario trajectory.
 */
export function evaluateDeterministicInvariants(trajectory = {}) {
  const diff =
    trajectory.snapshotDiff ||
    diffSnapshots(trajectory.beforeSnapshot || {}, trajectory.afterSnapshot || {});

  const allViolations = [
    ...checkStorageUploadedBy(diff.storage),
    ...checkSentryPrivacy(trajectory.sentryEvents || []),
    ...checkSubmissionRejectionIntegrity(diff.firestore, trajectory.expectations || {}),
    ...checkRtlHierarchy(trajectory.hierarchy || {}),
    ...checkServingScaling(trajectory.scalingObservations || []),
    ...checkNativeCrashes(trajectory.runtimeLogs || ''),
  ];

  const p0Violations = allViolations.filter((v) => v.severity === 'P0');
  const p1Violations = allViolations.filter((v) => v.severity !== 'P0');

  return {
    ok: allViolations.length === 0,
    p0Passed: p0Violations.length === 0,
    p0Violations,
    p1Violations,
    allViolations,
    snapshotDiff: diff,
  };
}
