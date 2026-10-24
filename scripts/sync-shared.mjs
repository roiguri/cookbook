/**
 * Copy the app's shared modules into functions/ (Cloud Functions deploy only the
 * functions/ folder, so they can't import from src/). The copies are committed;
 * edit the source, then run `npm run sync:shared`.
 *
 * The copies are `.mjs` so the CommonJS functions load them with `await import()`.
 * A unit test (tests/js/shared/shared-sync.test.mjs) and the functions predeploy
 * (`--check`) fail while a copy is stale.
 *
 * Usage: node scripts/sync-shared.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** [source, generated copy], relative to the repo root. */
export const SHARED_FILES = [
  ['src/js/shared/recipe-model.js', 'functions/shared/recipe-model.mjs'],
];

/**
 * The expected content of each generated copy.
 * @returns {Array<{ source: string, target: string, content: string }>}
 */
export function expectedCopies() {
  return SHARED_FILES.map(([source, target]) => ({
    source,
    target,
    content:
      `// GENERATED from ${source} by scripts/sync-shared.mjs — do not edit.\n` +
      fs.readFileSync(path.join(ROOT, source), 'utf8'),
  }));
}

/**
 * The generated copies that are missing or differ from their source.
 * @returns {string[]} target paths
 */
export function staleCopies() {
  return expectedCopies()
    .filter(({ target, content }) => {
      const file = path.join(ROOT, target);
      return !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content;
    })
    .map(({ target }) => target);
}

function main() {
  if (process.argv.includes('--check')) {
    const stale = staleCopies();
    if (stale.length) {
      console.error(`Stale shared copies: ${stale.join(', ')} — run \`npm run sync:shared\`.`);
      process.exit(1);
    }
    console.log('Shared copies are up to date.');
    return;
  }
  for (const { target, content } of expectedCopies()) {
    fs.mkdirSync(path.dirname(path.join(ROOT, target)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, target), content);
    console.log(`Wrote ${target}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
