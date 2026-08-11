#!/usr/bin/env node
/**
 * One-off Admin SDK backfill: writes `visibility` on every `recipes` doc
 * derived from the legacy `approved` field.
 *
 *   approved === true  -> visibility: 'public'
 *   anything else      -> visibility: 'pending'   (approved: false or missing)
 *
 * Idempotent: docs whose `visibility` already matches the target are
 * skipped, so the script is safe to re-run.
 *
 * See docs/feature-plans/personal-collections.md, Slice 0.1 and 0.2, and
 * scripts/README.md for the required ordering (backfill -> verify -> rules
 * deploy).
 *
 * Usage:
 *   node backfill/backfill-visibility.mjs --project <project-id>              # dry run
 *   node backfill/backfill-visibility.mjs --project <project-id> --apply      # writes
 *   node backfill/backfill-visibility.mjs --project <project-id> --verify     # check only
 *
 * Auth: Application Default Credentials — either run
 *   `gcloud auth application-default login`
 * or set GOOGLE_APPLICATION_CREDENTIALS to a service account key file.
 *
 * Project: --project <project-id> or the GOOGLE_CLOUD_PROJECT env var.
 * No project id is hardcoded here on purpose — see scripts/README.md.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const RECIPES_COLLECTION = 'recipes';
const PAGE_SIZE = 500; // also the Firestore batch write limit

function printHelp() {
  console.log(`
Backfill 'visibility' on the recipes collection from the legacy 'approved' field.

Usage:
  node backfill/backfill-visibility.mjs --project <project-id> [--apply | --verify]

Options:
  --project <project-id>  Target Firebase project. Required. May also be set
                           via the GOOGLE_CLOUD_PROJECT env var.
  --apply                 Write the changes (batched). Without this flag the
                           script only reports what it would change.
  --verify                Standalone completeness check: counts recipes
                           missing 'visibility' (expected 0) and exits
                           non-zero if any are found. Ignores --apply.
  -h, --help               Show this help.

Examples:
  node backfill/backfill-visibility.mjs --project <project-id>
  node backfill/backfill-visibility.mjs --project <project-id> --apply
  node backfill/backfill-visibility.mjs --project <project-id> --verify
`);
}

function parseArgs(argv) {
  const flags = { apply: false, verify: false, project: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') {
      flags.apply = true;
    } else if (arg === '--verify') {
      flags.verify = true;
    } else if (arg === '--project') {
      flags.project = argv[++i] ?? null;
    } else if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }
  return flags;
}

function computeTargetVisibility(data) {
  return data.approved === true ? 'public' : 'pending';
}

/**
 * Pages through the recipes collection ordered by document ID, yielding one
 * page of QueryDocumentSnapshots at a time so a large collection is never
 * held fully in memory.
 */
async function* pageRecipes(db, fields) {
  let lastDoc = null;
  for (;;) {
    let query = db
      .collection(RECIPES_COLLECTION)
      .select(...fields)
      .orderBy('__name__')
      .limit(PAGE_SIZE);
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }
    const snapshot = await query.get();
    if (snapshot.empty) {
      return;
    }
    yield snapshot.docs;
    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.docs.length < PAGE_SIZE) {
      return;
    }
  }
}

async function backfill(db, apply) {
  const counts = { total: 0, toPublic: 0, toPending: 0, alreadyCorrect: 0 };
  let batch = db.batch();
  let pendingInBatch = 0;
  let batchesCommitted = 0;

  for await (const docs of pageRecipes(db, ['approved', 'visibility'])) {
    for (const doc of docs) {
      counts.total++;
      const data = doc.data();
      const target = computeTargetVisibility(data);

      if (data.visibility === target) {
        counts.alreadyCorrect++;
        continue;
      }

      if (target === 'public') {
        counts.toPublic++;
      } else {
        counts.toPending++;
      }

      if (apply) {
        batch.update(doc.ref, { visibility: target });
        pendingInBatch++;
        if (pendingInBatch === PAGE_SIZE) {
          await batch.commit();
          batchesCommitted++;
          batch = db.batch();
          pendingInBatch = 0;
        }
      }
    }
  }

  if (apply && pendingInBatch > 0) {
    await batch.commit();
    batchesCommitted++;
  }

  return { counts, batchesCommitted };
}

async function verify(db) {
  let total = 0;
  let missing = 0;

  for await (const docs of pageRecipes(db, ['visibility'])) {
    for (const doc of docs) {
      total++;
      if (doc.get('visibility') === undefined) {
        missing++;
      }
    }
  }

  console.log(`Scanned ${total} recipe(s).`);
  console.log(`Missing 'visibility': ${missing} (expected 0)`);
  console.log(missing === 0 ? 'PASS' : 'FAIL');
  return missing === 0;
}

function resolveProjectId(flags) {
  return flags.project || process.env.GOOGLE_CLOUD_PROJECT || null;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(flags);

  if (!projectId) {
    console.error(
      'Missing project id. Pass --project <project-id> or set GOOGLE_CLOUD_PROJECT.\n' +
        'No project id is hardcoded in this script — see scripts/README.md.',
    );
    process.exit(1);
  }

  initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();

  if (flags.verify) {
    const ok = await verify(db);
    process.exit(ok ? 0 : 1);
    return;
  }

  const { counts, batchesCommitted } = await backfill(db, flags.apply);

  console.log(`Scanned ${counts.total} recipe(s) in '${RECIPES_COLLECTION}'.`);
  console.log(
    `  approved:true  -> visibility:'public'  : ${counts.toPublic} ${flags.apply ? '(written)' : '(would write)'}`,
  );
  console.log(
    `  approved:false/missing -> visibility:'pending' : ${counts.toPending} ${
      flags.apply ? '(written)' : '(would write)'
    }`,
  );
  console.log(`  already correct (skipped): ${counts.alreadyCorrect}`);

  if (!flags.apply) {
    console.log('\nDry run only — no writes made. Re-run with --apply to write changes.');
  } else {
    console.log(`\nCommitted ${batchesCommitted} batch(es).`);
    console.log('Re-run with --verify to confirm completeness before deploying rules.');
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
