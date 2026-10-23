import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { staleCopies, SHARED_FILES } from '../../../scripts/sync-shared.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('shared modules copied into functions/', () => {
  it('are up to date (run `npm run sync:shared` after editing src/js/shared)', () => {
    expect(staleCopies()).toEqual([]);
  });

  // Jest transforms modules, so load each copy the way Cloud Functions will: a
  // CommonJS script in a plain Node process doing `await import()`.
  it.each(SHARED_FILES)('%s loads from CommonJS in plain Node', (_source, target) => {
    const url = pathToFileURL(path.join(ROOT, target)).href;
    const script = `import(${JSON.stringify(url)})
      .then((m) => console.log(Object.keys(m).length))
      .catch((e) => { console.error(e.message); process.exit(1); });`;
    // No inherited NODE_OPTIONS (npm test sets --experimental-vm-modules): plain Node.
    const run = spawnSync(process.execPath, ['--input-type=commonjs', '-e', script], {
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '' },
    });
    if (run.status !== 0) throw new Error(`loading ${target} failed:\n${run.stderr}`);
    expect(Number(run.stdout.trim())).toBeGreaterThan(0);
  });
});
