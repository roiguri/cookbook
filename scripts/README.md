# Maintenance scripts

One-off Admin SDK scripts for direct Firestore maintenance. These are not part
of the app build (Vite/Jest/ESLint from the repo root leave this folder
alone beyond linting the script sources) — run them manually from a developer
machine or Cloud Shell, deliberately outside CI.

Layout: one-off backfills live in `backfill/` (existing convention —
`remove-compressed-field.js` predates this README). Legacy `.js` scripts are
CommonJS; new scripts are ESM via the `.mjs` extension. This folder has its
own `package.json` so `firebase-admin` doesn't become a dependency of the app
itself.

## Prerequisites

1. Install this folder's dependencies:

   ```bash
   cd scripts
   npm install
   ```

2. Authenticate with Application Default Credentials — either:
   - `gcloud auth application-default login`, or
   - set `GOOGLE_APPLICATION_CREDENTIALS` to point at a service account key
     file.

3. Know which Firebase project you're targeting and pass it explicitly —
   no project id is hardcoded in these scripts. Use `--project <project-id>`
   or set the `GOOGLE_CLOUD_PROJECT` env var. Find the real id in the
   Firebase console or wherever your own project notes live.

## backfill/backfill-visibility.mjs

Writes `visibility` on every `recipes` doc, derived from the legacy
`approved` field: `approved: true → 'public'`, anything else (`false` or
missing) → `'pending'`. Idempotent — a doc whose `visibility` already
matches the target is skipped, so it's safe to re-run.

Dry run (default, no writes):

```bash
node backfill/backfill-visibility.mjs --project <project-id>
```

Apply the writes (batched, 500 per commit):

```bash
node backfill/backfill-visibility.mjs --project <project-id> --apply
```

Verify (standalone completeness check — counts recipes still missing
`visibility`, expected zero, exits non-zero otherwise):

```bash
node backfill/backfill-visibility.mjs --project <project-id> --verify
```

## Stage 0 ordering

Per `docs/feature-plans/personal-collections.md` (Slice 0.2): **backfill →
verify → only then deploy the rules lockdown**
(`firebase deploy --only firestore:rules`). The Stage 0 read rule keys off
`approved`, not `visibility`, so it degrades gracefully if the backfill is
incomplete — but the Stage 1+ surfaces built on top assume every recipe has
a correct `visibility`. Don't skip the verify step.

## backfill/migrate-favorites.mjs

Copies each user's legacy `favorites` array entries into
`users/{uid}/collection/{recipeId}` documents (`source: 'saved'`, `state:
'rotation'` — see Slice 1.2 for why migrated favorites land at `rotation`
instead of the usual `to-try`). Idempotent — an entry that already exists
(doc ID = recipe ID) is skipped, so it's safe to re-run. Does not delete
the `favorites` array; a later stage does that.

Dry run (default, no writes):

```bash
node backfill/migrate-favorites.mjs --project <project-id>
```

Apply the writes (batched, 500 per commit):

```bash
node backfill/migrate-favorites.mjs --project <project-id> --apply
```

Verify (per-user count of favorites entries pointing at existing, approved
recipes vs collection docs with `source: 'saved'`; reports mismatches):

```bash
node backfill/migrate-favorites.mjs --project <project-id> --verify
```
