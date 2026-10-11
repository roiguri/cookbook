#!/usr/bin/env node
// =============================================================================
// Release 2 — convert the data model (docs/archive/private-recipes-and-collections.md)
//
// For every recipe, fills in the new-model fields that are missing:
//   authorId   = userId, or null for recipes with no recorded author
//   visibility = approved ? 'published' : 'private'
//   stage      = 'tested'
// and creates a pending `recipe_submissions/{recipeId}` for every open proposal
// (approved === false) that doesn't have one yet. Old fields are left untouched.
//
// Safe to re-run: it only adds what's missing. A recipe whose existing
// `visibility` disagrees with `approved` is reported, never changed.
//
// Usage (from the repo root; uses your gcloud application-default credentials):
//   node scripts/migrations/002-convert-model.mjs --project staging            # dry run
//   node scripts/migrations/002-convert-model.mjs --project staging --apply
//   node scripts/migrations/002-convert-model.mjs --project production --apply
// `--project` takes a .firebaserc alias; there is no default.
// =============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const alias = args[args.indexOf('--project') + 1];
const APPLY = args.includes('--apply');
if (!args.includes('--project') || !alias || alias.startsWith('--')) {
  console.error('Usage: 002-convert-model.mjs --project <staging|production> [--apply]');
  process.exit(2);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const projects = JSON.parse(readFileSync(join(root, '.firebaserc'), 'utf8')).projects;
const projectId = projects[alias];
if (!projectId) {
  console.error(`Unknown .firebaserc alias: ${alias}`);
  process.exit(2);
}

initializeApp({ projectId });
const db = getFirestore();

console.log(
  `==> project: ${alias} (${projectId})${APPLY ? '' : ' — dry run, pass --apply to write'}`,
);

async function main() {
  const recipes = await db.collection('recipes').get();
  const submissions = await db.collection('recipe_submissions').get();
  const submitted = new Set(submissions.docs.map((d) => d.id));

  const recipePatches = [];
  const newSubmissions = [];
  const inconsistent = [];
  const counts = { published: 0, private: 0, noAuthor: 0, alreadyConverted: 0 };

  for (const doc of recipes.docs) {
    const r = doc.data();
    const published = r.approved === true;
    const patch = {};

    if (!('authorId' in r)) patch.authorId = r.userId ?? null;
    if (!('visibility' in r)) patch.visibility = published ? 'published' : 'private';
    if (!('stage' in r)) patch.stage = 'tested';

    const visibility = r.visibility ?? patch.visibility;
    if ((visibility === 'published') !== published) {
      inconsistent.push(`${doc.id} (approved=${r.approved}, visibility=${r.visibility})`);
    }
    counts[visibility === 'published' ? 'published' : 'private'] += 1;
    if ((r.authorId ?? patch.authorId ?? null) === null) counts.noAuthor += 1;

    if (Object.keys(patch).length) recipePatches.push({ ref: doc.ref, patch });
    else counts.alreadyConverted += 1;

    if (r.approved === false && !submitted.has(doc.id)) {
      newSubmissions.push({
        ref: db.collection('recipe_submissions').doc(doc.id),
        data: {
          recipeId: doc.id,
          authorId: r.authorId ?? r.userId ?? null,
          status: 'pending',
          reviewedBy: null,
          reviewedAt: null,
          rejectionReason: null,
          publishedId: null,
          createdAt: r.creationTime ?? Timestamp.now(),
        },
      });
    }
  }

  console.log(
    `==> recipes: ${recipes.size} (${counts.published} published, ${counts.private} private)`,
  );
  console.log(
    `    to convert: ${recipePatches.length} | already converted: ${counts.alreadyConverted}`,
  );
  console.log(`    with no recorded author (authorId null): ${counts.noAuthor}`);
  console.log(`==> submissions to create for open proposals: ${newSubmissions.length}`);
  if (inconsistent.length) {
    console.log(
      `==> WARNING — approved/visibility disagree on ${inconsistent.length} recipe(s), left as is:`,
    );
    inconsistent.forEach((line) => console.log(`    ${line}`));
  }

  if (!APPLY) {
    console.log('==> dry run: nothing written');
    return;
  }

  const writes = [
    ...recipePatches.map(
      ({ ref, patch }) =>
        (batch) =>
          batch.update(ref, patch),
    ),
    ...newSubmissions.map(
      ({ ref, data }) =>
        (batch) =>
          batch.create(ref, data),
    ),
  ];
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    writes.slice(i, i + 400).forEach((write) => write(batch));
    await batch.commit();
  }
  console.log(
    `==> written: ${recipePatches.length} recipe(s) converted, ${newSubmissions.length} submission(s) created`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
