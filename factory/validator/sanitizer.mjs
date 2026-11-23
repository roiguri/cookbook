/**
 * Zero-Leakage Sanitized Behavioral Failure Ticket Synthesizer.
 *
 * Ensures Builder Agents NEVER see holdout repository file paths, scenario IDs
 * tied to hidden suites, raw Maestro YAML assertions, or rubric internals.
 * Emits only observable user-facing symptoms, platform, route, role, cropped
 * screenshot reference, and redacted log/rule snippets.
 */
import crypto from 'node:crypto';

const LEAK_PATTERNS = [
  /\.factory-holdout[^\s"'`)]*/gi,
  /cookbook-factory-holdout[^\s"'`)]*/gi,
  /\/holdout\/[^\s"'`)]*/gi,
  /\/out\/debug\/[^\s"'`)]*/gi,
  /(?:\.\.\/)*_subflows\/[a-z0-9_.-]+\.ya?ml/gi,
  /\bsuite-[a-l]-[a-z0-9-]+\b/gi,
  /\b(?:scenarios|rubrics|assertions)\/[a-z0-9_./-]+\.(?:ya?ml|md|mjs|json)\b/gi,
  /\b(?:extendedWaitUntil|assertVisible|assertNotVisible|tapOn|launchApp)\b\s*[:(][^\n]*/gi,
];

const SECRET_PATTERNS = [
  { regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replacement: '[REDACTED_EMAIL]' },
  { regex: /\bcbk_[A-Za-z0-9_-]{8,}\b/g, replacement: '[REDACTED_API_TOKEN]' },
  { regex: /Bearer\s+[A-Za-z0-9._-]+/gi, replacement: 'Bearer [REDACTED]' },
];

export function redactText(input) {
  if (!input || typeof input !== 'string') return '';
  let out = input;
  for (const pattern of LEAK_PATTERNS) {
    out = out.replace(pattern, '[REDACTED_VALIDATOR_REF]');
  }
  for (const { regex, replacement } of SECRET_PATTERNS) {
    out = out.replace(regex, replacement);
  }
  return out.trim();
}

/**
 * Convert a scenario judgment + deterministic check output into clean,
 * zero-leakage Behavioral Failure Tickets consumable by Fix Builder Agents.
 */
export function synthesizeSanitizedTickets(
  judgment,
  { screenshotRef = null, logExcerpt = '' } = {},
) {
  const findings = Array.isArray(judgment?.findings) ? judgment.findings : [];
  if (judgment?.passed && !judgment?.p0Violation && findings.length === 0) {
    return [];
  }

  const tickets = [];
  const sourceFindings =
    findings.length > 0
      ? findings
      : [
          {
            severity: judgment?.p0Violation ? 'P0' : 'P1',
            domain: 'general',
            route: '/home',
            role: 'unknown',
            symptom: judgment?.rationale || 'Observed behavioral regression during validation.',
            evidence: '',
          },
        ];

  for (const finding of sourceFindings) {
    const symptom = redactText(finding.symptom || 'Behavioral defect observed.');
    const evidence = redactText(finding.evidence || '');
    const redactedLog = redactText(logExcerpt).slice(0, 800);
    const hash = crypto
      .createHash('sha256')
      .update(`${judgment?.platform || 'android'}|${finding.domain}|${finding.route}|${symptom}`)
      .digest('hex')
      .slice(0, 10);

    tickets.push({
      ticketId: `TKT-${hash.toUpperCase()}`,
      severity: ['P0', 'P1', 'P2'].includes(finding.severity) ? finding.severity : 'P1',
      platform: judgment?.platform || 'android',
      domain: redactText(finding.domain || 'general'),
      route: redactText(finding.route || '/home'),
      role: redactText(finding.role || 'approved'),
      symptom,
      evidence,
      screenshotRef: screenshotRef ? redactText(screenshotRef) : null,
      redactedLogExcerpt: redactedLog || null,
    });
  }

  return tickets;
}

/**
 * Verification assertion used in tests & calibration to prove zero leakage
 * of holdout file paths, YAML commands, or secrets in emitted tickets.
 */
export function assertZeroHoldoutLeakage(tickets) {
  const serialized = JSON.stringify(tickets);
  for (const pattern of LEAK_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(serialized)) {
      throw new Error(`Holdout leakage detected matching ${pattern}`);
    }
  }
  for (const { regex } of SECRET_PATTERNS) {
    regex.lastIndex = 0;
    if (regex.test(serialized)) {
      throw new Error(`Secret/PII leakage detected matching ${regex}`);
    }
  }
  return true;
}
