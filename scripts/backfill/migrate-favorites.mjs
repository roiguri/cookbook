#!/usr/bin/env node
/**
 * One-off Admin SDK migration: copies each user's legacy `favorites` array
 * entries into `users/{uid}/collection/{recipeId}` documents.
 *
 * Migration state decision (see docs/feature-plans/personal-collections.md,
 * Slice 1.2): migrated entries land at `state: 'rotation'`, not `to-try`.
 * Hearting was the closest thing to endorsement the old model had, so
 * dumping existing favorites into a "to try" queue would misrepresent them.
 * This is the one exception to "everything enters at to-try" — it applies
 * only to migrated data.
 *
 * Per favorite recipe ID:
 *   - entry already exists (doc ID == recipe ID)  -> skipped (idempotent)
 *   - recipe no longer exists                     -> skipped, counted
 *     (dangling; no card data left to build a tombstone from)
 *   - recipe exists but isn't approved             -> skipped, counted
 *     (shouldn't happen — the heart only ever rendered on approved cards —
 *     but verified rather than assumed)
 *   - otherwise                                    -> collection entry
 *     written: { source: 'saved', state: 'rotation', addedAt, card }
 *
 * `card` is the denormalised render shape `{ name, category, primaryImage,
 * prepTime }` — primaryImage mirrors getPrimaryImage() from
 * src/js/utils/recipes/recipe-image-utils.js (isPrimary image, else the
 * first one), storing its Storage path (`image.full`), the same field the
 * live app resolves to a download URL at render time. Kept dependency-free
 * here rather than importing the browser util.
 *
 * Idempotent by construction (entry ID = recipe ID), so it's safe to
 * re-run — hearts written mid-run are simply picked up next run. Does NOT
 * delete the `favorites` array; a later stage does that.
 *
 * Usage:
 *   node backfill/migrate-favorites.mjs --project <project-id>              # dry run
 *   node backfill/migrate-favorites.mjs --project <project-id> --apply      # writes
 *   node backfill/migrate-favorites.mjs --project <project-id> --verify     # check only
 *
 * Auth: Application Default Credentials — either run
 *   `gcloud auth application-default login`
 * or set GOOGLE_APPLICATION_CREDENTIALS to a service account key file.
 *
 * Project: --project <project-id> or the GOOGLE_CLOUD_PROJECT env var.
 * No project id is hardcoded here on purpose — see scripts/README.md.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const USERS_COLLECTION = 'users';
const RECIPES_COLLECTION = 'recipes';
const COLLECTION_SUBCOLLECTION = 'collection';
const PAGE_SIZE = 500; // also the Firestore batch write limit

function printHelp() {
  console.log(`
Migrate each user's legacy 'favorites' array into 'users/{uid}/collection'
documents ('source: saved', 'state: rotation').

Usage:
  node backfill/migrate-favorites.mjs --project <project-id> [--apply | --verify]

Options:
  --project <project-id>  Target Firebase project. Required. May also be set
                           via the GOOGLE_CLOUD_PROJECT env var.
  --apply                 Write the changes (batched). Without this flag the
                           script only reports what it would change.
  --verify                Standalone completeness check: per-user count of
                           favorites entries pointing at existing, approved
                           recipes vs collection docs with source 'saved'.
                           Reports mismatches. Ignores --apply.
  -h, --help               Show this help.

Examples:
  node backfill/migrate-favorites.mjs --project <project-id>
  node backfill/migrate-favorites.mjs --project <project-id> --apply
  node backfill/migrate-favorites.mjs --project <project-id> --verify
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

/**
 * Pages through the users collection ordered by document ID, yielding one
 * page of QueryDocumentSnapshots at a time so a large collection is never
 * held fully in memory.
 */
async function* pageUsers(db) {
  let lastDoc = null;
  for (;;) {
    let query = db
      .collection(USERS_COLLECTION)
      .select('favorites')
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

/**
 * Mirrors getPrimaryImage() from recipe-image-utils.js: the isPrimary
 * image, falling back to the first one. Returns its Storage path (`full`),
 * or undefined when the recipe has no images.
 */
function getPrimaryImagePath(recipe) {
  if (!recipe || !Array.isArray(recipe.images) || recipe.images.length === 0) {
    return undefined;
  }
  const primary = recipe.images.find((img) => img.isPrimary);
  return (primary || recipe.images[0])?.full;
}

function buildCard(recipe) {
  const card = {
    name: recipe.name ?? null,
    category: recipe.category ?? null,
    prepTime: recipe.prepTime ?? null,
  };
  const primaryImage = getPrimaryImagePath(recipe);
  if (primaryImage) {
    card.primaryImage = primaryImage;
  }
  return card;
}

function normalizeFavoriteIds(favorites) {
  if (!Array.isArray(favorites)) return [];
  return favorites.filter((id) => typeof id === 'string' && id.length > 0);
}

async function migrate(db, apply) {
  const counts = {
    usersScanned: 0,
    usersWithFavorites: 0,
    pointersSeen: 0,
    created: 0,
    alreadyExists: 0,
    danglingSkipped: 0,
    unapprovedSkipped: 0,
  };
  let batch = db.batch();
  let pendingInBatch = 0;
  let batchesCommitted = 0;

  for await (const userDocs of pageUsers(db)) {
    for (const userDoc of userDocs) {
      counts.usersScanned++;
      const favoriteIds = normalizeFavoriteIds(userDoc.get('favorites'));
      if (favoriteIds.length === 0) continue;
      counts.usersWithFavorites++;
      const uid = userDoc.id;

      for (const recipeId of favoriteIds) {
        counts.pointersSeen++;

        const entryRef = db
          .collection(USERS_COLLECTION)
          .doc(uid)
          .collection(COLLECTION_SUBCOLLECTION)
          .doc(recipeId);
        const entrySnap = await entryRef.get();
        if (entrySnap.exists) {
          counts.alreadyExists++;
          continue;
        }

        const recipeSnap = await db.collection(RECIPES_COLLECTION).doc(recipeId).get();
        if (!recipeSnap.exists) {
          counts.danglingSkipped++;
          continue;
        }

        const recipe = recipeSnap.data();
        if (recipe.approved !== true) {
          counts.unapprovedSkipped++;
          continue;
        }

        counts.created++;

        if (apply) {
          const payload = {
            source: 'saved',
            state: 'rotation',
            addedAt: Timestamp.now(),
            card: buildCard(recipe),
          };
          batch.set(entryRef, payload);
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
  }

  if (apply && pendingInBatch > 0) {
    await batch.commit();
    batchesCommitted++;
  }

  return { counts, batchesCommitted };
}

async function verify(db) {
  let usersScanned = 0;
  const mismatches = [];

  for await (const userDocs of pageUsers(db)) {
    for (const userDoc of userDocs) {
      usersScanned++;
      const favoriteIds = normalizeFavoriteIds(userDoc.get('favorites'));
      if (favoriteIds.length === 0) continue;
      const uid = userDoc.id;

      let expected = 0;
      for (const recipeId of favoriteIds) {
        const recipeSnap = await db.collection(RECIPES_COLLECTION).doc(recipeId).get();
        if (recipeSnap.exists && recipeSnap.data().approved === true) {
          expected++;
        }
      }

      const savedEntries = await db
        .collection(USERS_COLLECTION)
        .doc(uid)
        .collection(COLLECTION_SUBCOLLECTION)
        .where('source', '==', 'saved')
        .get();
      const actual = savedEntries.size;

      if (actual !== expected) {
        mismatches.push({ uid, expected, actual });
      }
    }
  }

  console.log(`Scanned ${usersScanned} user(s).`);
  console.log(`Mismatches: ${mismatches.length} (expected 0)`);
  for (const { uid, expected, actual } of mismatches) {
    console.log(
      `  ${uid}: favorites(existing+approved)=${expected} collection(source=saved)=${actual}`,
    );
  }
  console.log(mismatches.length === 0 ? 'PASS' : 'FAIL');
  return mismatches.length === 0;
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

  const { counts, batchesCommitted } = await migrate(db, flags.apply);

  console.log(
    `Scanned ${counts.usersScanned} user(s), ${counts.usersWithFavorites} with favorites.`,
  );
  console.log(`Favorite pointers seen: ${counts.pointersSeen}`);
  console.log(`  ${flags.apply ? 'created' : 'would create'}: ${counts.created}`);
  console.log(`  already migrated (skipped): ${counts.alreadyExists}`);
  console.log(`  dangling — recipe no longer exists (skipped): ${counts.danglingSkipped}`);
  console.log(`  unapproved recipe (skipped): ${counts.unapprovedSkipped}`);

  if (!flags.apply) {
    console.log('\nDry run only — no writes made. Re-run with --apply to write changes.');
  } else {
    console.log(`\nCommitted ${batchesCommitted} batch(es).`);
    console.log('Re-run with --verify to confirm completeness.');
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
