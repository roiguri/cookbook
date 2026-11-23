/**
 * Visible Inner Gate Runner for the Cookbook Native Software Factory.
 *
 * Runs strictly visible repository checks (zero holdout exposure):
 *   1. Mobile static architecture lint (two-tier Firebase boundary, zero raw hex
 *      outside theme/games-host, RTL logical margin/padding properties).
 *   2. `npm --prefix apps/mobile run typecheck` (`tsc --noEmit`).
 *   3. `npm run lint` & `npm --prefix functions run lint`.
 *   4. `npm run check:tokens` & `node scripts/sync-shared.mjs --check`.
 *   5. `npm test` (web + shared + validator + orchestrator tests).
 *   6. `npm run build` (Web SPA production build remains 100% green).
 *   7. Optional Android local APK build + visible Maestro smoke (`--with-android-smoke`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const RAW_HEX_RE = /['"`](#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8}))['"`]/g;
const PHYSICAL_RTL_PROP_RE = /\b(marginLeft|marginRight|paddingLeft|paddingRight)\s*:/g;
const RAW_FIREBASE_IMPORT_RE =
  /from\s+['"](?:firebase\/(?:auth|firestore|storage|functions)|[^'"]*\/_firebase\/[^'"]+)['"]/g;

function walkTsFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTsFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Static architecture check across all TypeScript/TSX files under apps/mobile/app and apps/mobile/src.
 */
export function checkMobileArchitecture(rootDir = ROOT) {
  const mobileRoot = path.join(rootDir, 'apps/mobile');
  const files = [
    ...walkTsFiles(path.join(mobileRoot, 'app')),
    ...walkTsFiles(path.join(mobileRoot, 'src')),
  ];

  const violations = [];
  for (const full of files) {
    const rel = path.relative(rootDir, full).replace(/\\/g, '/');
    const src = fs.readFileSync(full, 'utf8');

    const isService = rel.startsWith('apps/mobile/src/services/');
    const isThemeOrGame =
      rel.startsWith('apps/mobile/src/theme/') ||
      rel.startsWith('apps/mobile/src/games-host/') ||
      rel.includes('avatar-builder');

    if (!isService) {
      RAW_FIREBASE_IMPORT_RE.lastIndex = 0;
      const m = RAW_FIREBASE_IMPORT_RE.exec(src);
      if (m) {
        violations.push({
          rule: 'INV-P1-TWO-TIER-FIREBASE',
          file: rel,
          detail: `Direct Firebase / _firebase import forbidden outside apps/mobile/src/services/: ${m[0]}`,
        });
      }
    }

    if (!isThemeOrGame) {
      RAW_HEX_RE.lastIndex = 0;
      const m = RAW_HEX_RE.exec(src);
      if (m) {
        violations.push({
          rule: 'INV-P1-DESIGN-TOKENS',
          file: rel,
          detail: `Raw hex color ${m[1]} forbidden outside theme/avatar/games-host; import from @cookbook/tokens.`,
        });
      }
    }

    // Physical marginLeft/Right/paddingLeft/Right forbidden unless line has explicit `// rtl-ok:`
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('rtl-ok:')) continue;
      PHYSICAL_RTL_PROP_RE.lastIndex = 0;
      const m = PHYSICAL_RTL_PROP_RE.exec(line);
      if (m) {
        violations.push({
          rule: 'INV-P0-RTL-LOGICAL-PROPS',
          file: `${rel}:${i + 1}`,
          detail: `Use logical RTL property (marginStart/marginEnd/paddingStart/paddingEnd) instead of ${m[1]}.`,
        });
      }
    }
  }

  return { ok: violations.length === 0, checkedFiles: files.length, violations };
}

function runCmd(label, cmd, args, cwd) {
  const t0 = Date.now();
  const res = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
  });
  return {
    label,
    ok: res.status === 0,
    durationMs: Date.now() - t0,
    output: `${res.stdout || ''}\n${res.stderr || ''}`.slice(-4000),
  };
}

export function runVisibleInnerGate({
  rootDir = ROOT,
  withTests = true,
  withBuild = true,
  withAndroidSmoke = false,
} = {}) {
  const results = [];

  const arch = checkMobileArchitecture(rootDir);
  results.push({
    label: 'mobile-architecture-guard',
    ok: arch.ok,
    durationMs: 0,
    output: arch.ok
      ? `Checked ${arch.checkedFiles} TS/TSX file(s): 0 violations.`
      : arch.violations.map((v) => `[${v.rule}] ${v.file}: ${v.detail}`).join('\n'),
  });

  results.push(
    runCmd('mobile-typecheck', 'npm', ['--prefix', 'apps/mobile', 'run', 'typecheck'], rootDir),
  );
  results.push(runCmd('root-lint', 'npm', ['run', 'lint'], rootDir));
  results.push(runCmd('functions-lint', 'npm', ['--prefix', 'functions', 'run', 'lint'], rootDir));
  results.push(runCmd('check-tokens', 'npm', ['run', 'check:tokens'], rootDir));
  results.push(
    runCmd('check-shared-sync', 'node', ['scripts/sync-shared.mjs', '--check'], rootDir),
  );

  if (withTests) {
    results.push(runCmd('unit-tests', 'npm', ['test'], rootDir));
  }
  if (withBuild) {
    results.push(runCmd('web-build', 'npm', ['run', 'build'], rootDir));
  }
  if (withAndroidSmoke) {
    results.push(runCmd('android-build', 'npm', ['run', 'mobile:build:android'], rootDir));
    results.push(runCmd('android-smoke', 'npm', ['run', 'mobile:smoke:android'], rootDir));
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, failedCount: failed.length, results };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const withAndroidSmoke = process.argv.includes('--with-android-smoke');
  const skipTests = process.argv.includes('--skip-tests');
  const skipBuild = process.argv.includes('--skip-build');
  const out = runVisibleInnerGate({
    withTests: !skipTests,
    withBuild: !skipBuild,
    withAndroidSmoke,
  });
  for (const r of out.results) {
    console.log(`[inner-gate] ${r.ok ? 'PASS' : 'FAIL'} ${r.label} (${r.durationMs}ms)`);
    if (!r.ok) console.error(r.output);
  }
  process.exit(out.ok ? 0 : 1);
}
