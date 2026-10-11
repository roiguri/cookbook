#!/usr/bin/env node
// =============================================================================
// Release 2b — restructure Storage (docs/archive/private-recipes-and-collections.md)
//
// Copies every recipe's files to the per-recipe layout and repoints the documents:
//   img/recipes/full/{category}/{recipeId}/{file}  ─┐
//   img/recipes/full/{category}/{file}  (legacy)   ─┴→ recipes/{recipeId}/images/{file}
//   recipes/{recipeId}/media-instructions/{file}     → recipes/{recipeId}/media/{file}
// Each image is copied with its resize-extension variants (_400x400 / _1080x1080
// WebP) and its AI-enhancer `_original` backup (and that backup's variants).
// Pending edit suggestions' own uploads move to suggestions/{suggestionId}/….
// Paths are then rewritten in `recipes` (images, mediaInstructions) and in
// `recipe_edit_suggestions` (proposedChanges, storagePaths).
//
// COPIES ONLY — old files are left for the cleanup release. Safe to re-run: files
// already copied are skipped and documents already repointed are unchanged.
// Requires 002-convert-model to have run (every recipe has `visibility`).
//
// Usage (repo root; gcloud application-default credentials):
//   node scripts/migrations/003-restructure-storage.mjs --project staging            # dry run
//   node scripts/migrations/003-restructure-storage.mjs --project staging --apply
// `--project` takes a .firebaserc alias; there is no default.
// =============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { rewriteStoragePaths } from '../../src/js/utils/recipes/storage-paths.js';

const args = process.argv.slice(2);
const alias = args[args.indexOf('--project') + 1];
const APPLY = args.includes('--apply');
if (!args.includes('--project') || !alias || alias.startsWith('--')) {
  console.error('Usage: 003-restructure-storage.mjs --project <staging|production> [--apply]');
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

const baseName = (path) => path.slice(path.lastIndexOf('/') + 1);
const withSuffix = (path, suffix) => path.replace(/(\.[^./]+)?$/, `${suffix}$1`);
const variant = (path, size) => path.replace(/\.[^./]+$/, `_${size}.webp`);
// An image's companion files: resized variants, the AI backup and its variants.
const companions = (path) => {
  const backup = withSuffix(path, '_original');
  return [
    variant(path, '400x400'),
    variant(path, '1080x1080'),
    backup,
    variant(backup, '400x400'),
    variant(backup, '1080x1080'),
  ];
};
const isOldImage = (path) => typeof path === 'string' && path.startsWith('img/recipes/');
const isOldMedia = (path, recipeId) =>
  typeof path === 'string' && path.startsWith(`recipes/${recipeId}/media-instructions/`);

async function findBucket() {
  for (const name of [`${projectId}.firebasestorage.app`, `${projectId}.appspot.com`]) {
    const bucket = getStorage().bucket(name);
    const [exists] = await bucket.exists().catch(() => [false]);
    if (exists) return bucket;
  }
  throw new Error(`No default Storage bucket found for ${projectId}`);
}

async function main() {
  console.log(
    `==> project: ${alias} (${projectId})${APPLY ? '' : ' — dry run, pass --apply to write'}`,
  );

  const recipes = await db.collection('recipes').get();
  const unconverted = recipes.docs.filter((doc) => !('visibility' in doc.data()));
  if (unconverted.length) {
    console.error(
      `ABORT: ${unconverted.length} recipe(s) have no visibility — run 002-convert-model first.`,
    );
    process.exit(1);
  }

  const bucket = await findBucket();
  const [files] = await bucket.getFiles();
  const existing = new Set(files.map((file) => file.name));
  console.log(`==> bucket ${bucket.name}: ${existing.size} files`);

  const copies = new Map(); // target → { source, retag }
  const mapping = {}; // old path → new path (main files referenced by documents)
  const missing = [];
  const plan = (source, target, retag) => {
    if (existing.has(source) && !existing.has(target) && !copies.has(target)) {
      copies.set(target, { source, retag });
    }
  };

  // 1. Recipe images and media.
  const recipeUpdates = [];
  let imagesMoved = 0;
  let mediaMoved = 0;
  for (const doc of recipes.docs) {
    const recipe = doc.data();
    const authorId = recipe.authorId ?? recipe.userId ?? null;
    // A copy keeps its uploadedBy tag only when it's the author's: anyone else
    // (e.g. a suggester) mustn't keep delete rights over the live recipe's files.
    const retag = (source) => ({ authorId, source });
    const recipeMapping = {};

    for (const image of Array.isArray(recipe.images) ? recipe.images : []) {
      if (!isOldImage(image?.full)) continue;
      if (!existing.has(image.full)) {
        missing.push(`${doc.id}: image ${image.full}`);
        continue;
      }
      const target = `recipes/${doc.id}/images/${baseName(image.full)}`;
      plan(image.full, target, retag(image.full));
      for (const extra of companions(image.full)) {
        plan(extra, `recipes/${doc.id}/images/${baseName(extra)}`, retag(extra));
      }
      recipeMapping[image.full] = target;
      imagesMoved += 1;
    }
    for (const media of Array.isArray(recipe.mediaInstructions) ? recipe.mediaInstructions : []) {
      if (!isOldMedia(media?.path, doc.id)) continue;
      if (!existing.has(media.path)) {
        missing.push(`${doc.id}: media ${media.path}`);
        continue;
      }
      const target = `recipes/${doc.id}/media/${baseName(media.path)}`;
      plan(media.path, target, retag(media.path));
      recipeMapping[media.path] = target;
      mediaMoved += 1;
    }

    Object.assign(mapping, recipeMapping);
    if (Object.keys(recipeMapping).length) {
      recipeUpdates.push({
        ref: doc.ref,
        patch: {
          images: rewriteStoragePaths(recipe.images, recipeMapping),
          ...(Array.isArray(recipe.mediaInstructions) && {
            mediaInstructions: rewriteStoragePaths(recipe.mediaInstructions, recipeMapping),
          }),
        },
      });
    }
  }

  // 2. Edit suggestions: pending ones get their own staged files moved to
  //    suggestions/{id}/; every suggestion is repointed at the new paths.
  const suggestions = await db.collection('recipe_edit_suggestions').get();
  const suggestionUpdates = [];
  let stagedMoved = 0;
  for (const doc of suggestions.docs) {
    const suggestion = doc.data();
    const own = { ...mapping };
    if (suggestion.status === 'pending') {
      for (const entry of Array.isArray(suggestion.storagePaths) ? suggestion.storagePaths : []) {
        const source = entry?.path;
        const old = isOldImage(source) || isOldMedia(source, suggestion.recipeId);
        if (!old || mapping[source]) continue; // already part of the recipe
        const kind = entry.type === 'media' ? 'media' : 'images';
        const target = `suggestions/${doc.id}/${kind}/${baseName(source)}`;
        plan(source, target, null); // stays the suggester's file
        if (kind === 'images') {
          for (const extra of companions(source)) {
            plan(extra, `suggestions/${doc.id}/images/${baseName(extra)}`, null);
          }
        }
        own[source] = target;
        stagedMoved += 1;
      }
    }
    const proposedChanges = rewriteStoragePaths(suggestion.proposedChanges, own);
    const storagePaths = rewriteStoragePaths(suggestion.storagePaths, own);
    if (
      JSON.stringify(proposedChanges) !== JSON.stringify(suggestion.proposedChanges) ||
      JSON.stringify(storagePaths) !== JSON.stringify(suggestion.storagePaths)
    ) {
      suggestionUpdates.push({
        ref: doc.ref,
        patch: {
          ...(suggestion.proposedChanges !== undefined && { proposedChanges }),
          ...(suggestion.storagePaths !== undefined && { storagePaths }),
        },
      });
    }
  }

  console.log(`==> recipes: ${recipes.size} | to repoint: ${recipeUpdates.length}`);
  console.log(`    images to move: ${imagesMoved} | media to move: ${mediaMoved}`);
  console.log(
    `==> edit suggestions: ${suggestions.size} | to repoint: ${suggestionUpdates.length} | staged files to move: ${stagedMoved}`,
  );
  console.log(`==> files to copy (incl. variants and backups): ${copies.size}`);
  if (missing.length) {
    console.log(`==> WARNING — ${missing.length} referenced file(s) not found, left as is:`);
    missing.forEach((line) => console.log(`    ${line}`));
  }
  if (!APPLY) {
    console.log('==> dry run: nothing written');
    return;
  }

  // 3. Copy files (before repointing documents, so a document never points at
  //    a file that isn't there yet).
  let copied = 0;
  for (const [target, { source, retag }] of copies) {
    await bucket.file(source).copy(bucket.file(target));
    if (retag) {
      const [metadata] = await bucket.file(target).getMetadata();
      const tag = metadata.metadata?.uploadedBy;
      if (tag && tag !== retag.authorId) {
        await bucket.file(target).setMetadata({ metadata: { uploadedBy: null } });
      }
    }
    copied += 1;
  }

  // 4. Repoint documents.
  const writes = [...recipeUpdates, ...suggestionUpdates];
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    writes.slice(i, i + 400).forEach(({ ref, patch }) => batch.update(ref, patch));
    await batch.commit();
  }
  console.log(
    `==> written: ${copied} file(s) copied, ${recipeUpdates.length} recipe(s) and ${suggestionUpdates.length} suggestion(s) repointed`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
