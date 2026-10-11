#!/usr/bin/env node
// =============================================================================
// Release 3b — give authorless recipes an author (docs/archive/private-recipes-and-collections.md)
//
// Recipes with no recorded author (authorId and userId both missing or null —
// older recipes from before authors were recorded) get the given user as their
// author, so they appear in that user's "My recipes" library. Both fields are
// set (they stay in sync until the cleanup release). Recipes that already have
// an author are never touched.
//
// The author is passed as a uid, never stored in the repo. Each Firebase project
// has its own accounts, so the uid differs per project: find it in the Firebase
// console (Authentication → Users), or as the id of your doc in `users` (role
// "manager").
//
// Safe to re-run: the second run finds nothing to change.
//
// Usage (from the repo root; uses your gcloud application-default credentials):
//   node scripts/migrations/004-backfill-author.mjs --project staging --author <uid>            # dry run
//   node scripts/migrations/004-backfill-author.mjs --project staging --author <uid> --apply
//   node scripts/migrations/004-backfill-author.mjs --project production --author <uid> --apply
// `--project` takes a .firebaserc alias; there is no default.
// =============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  const value = i >= 0 ? args[i + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
};
const alias = valueOf('--project');
const author = valueOf('--author');
const APPLY = args.includes('--apply');
if (!alias || !author) {
  console.error(
    'Usage: 004-backfill-author.mjs --project <staging|production> --author <uid> [--apply]',
  );
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
  const user = await db.collection('users').doc(author).get();
  if (!user.exists) {
    console.error(
      `==> no user ${author} in this project's users collection — wrong uid or project?`,
    );
    process.exit(2);
  }
  console.log(`==> author: ${author} (role: ${user.data().role ?? 'none'})`);

  const recipes = await db.collection('recipes').get();
  const authorless = recipes.docs.filter((doc) => {
    const r = doc.data();
    return (r.authorId ?? null) === null && (r.userId ?? null) === null;
  });
  const published = authorless.filter((doc) => doc.data().visibility === 'published').length;
  console.log(
    `==> recipes: ${recipes.size} | without an author: ${authorless.length} (${published} published)`,
  );

  if (!APPLY) {
    console.log('==> dry run: nothing written');
    return;
  }

  for (let i = 0; i < authorless.length; i += 400) {
    const batch = db.batch();
    authorless
      .slice(i, i + 400)
      .forEach((doc) => batch.update(doc.ref, { authorId: author, userId: author }));
    await batch.commit();
  }
  console.log(`==> written: ${authorless.length} recipe(s) now authored by ${author}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
