#!/usr/bin/env bash
# =============================================================================
# Copy production Firestore, Storage and Auth users into the TEST project, so
# migration scripts can be rehearsed on real data.
#
# Production is only ever READ. Every delete/overwrite targets the test project,
# and every destructive phase aborts if its target resolves to production.
#
# Projects come from .firebaserc aliases: source = "production", target = "staging"
# (the test project). App Storage buckets are looked up via the Firebase API.
# Bucket names for the transfer/backup buckets are passed in, not hardcoded —
# rediscover them with: gcloud storage buckets list --project <project-id>
#
# Usage:
#   scripts/migrations/000-copy-prod-to-test.sh <phase> [--apply] \
#     --transfer-bucket <bucket in production project> \
#     --backup-bucket <bucket in test project>
#
# Phases (run in this order; without --apply each phase only prints its plan
# or performs a dry run):
#   check      read-only: accounts, projects, buckets, counts
#   backup     export TEST Firestore + copy TEST Storage into the backup bucket
#   firestore  export PROD Firestore, wipe TEST Firestore, import the export
#   storage    mirror PROD Storage into TEST Storage (deletes test-only files)
#   auth       replace TEST Auth users with PROD users (password hashes kept)
#   verify     read-only: compare document, file and user counts
#
# Requires: gcloud, firebase CLI, python3, signed in as an owner of both projects.
# =============================================================================
set -euo pipefail

PHASE="${1:-}"
shift || true
APPLY=false
TRANSFER_BUCKET=""
BACKUP_BUCKET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=true ;;
    --transfer-bucket) TRANSFER_BUCKET="$2"; shift ;;
    --backup-bucket) BACKUP_BUCKET="$2"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

die() { echo "ABORT: $*" >&2; exit 1; }
log() { echo "==> $*"; }

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
alias_id() {
  python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['projects'][sys.argv[2]])" \
    "$ROOT/.firebaserc" "$1"
}
SRC="$(alias_id production)"
DST="$(alias_id staging)"

[[ -n "$SRC" && -n "$DST" ]] || die "could not resolve project aliases from .firebaserc"
[[ "$SRC" != "$DST" ]] || die "source and target resolve to the same project"

# The one guard that matters: nothing destructive may ever target production.
assert_not_prod() {
  [[ "$1" != "$SRC" ]] || die "refusing to modify the production project ($1)"
}
assert_not_prod_bucket() {
  [[ "$1" != "$SRC_BUCKET" ]] || die "refusing to modify the production bucket ($1)"
}

token() { gcloud auth print-access-token; }
api() { # api <quota-project> <METHOD> <url> [json-body]
  local body="${4:-}"
  curl -sS -X "$2" -H "Authorization: Bearer $(token)" -H "x-goog-user-project: $1" \
    -H "Content-Type: application/json" ${body:+-d "$body"} "$3"
}
storage_bucket() { # the project's single Firebase-linked bucket; refuses to guess between several
  api "$1" GET "https://firebasestorage.googleapis.com/v1beta/projects/$1/buckets" |
    python3 -c "
import json, sys
names = [b['name'].split('/')[-1] for b in json.load(sys.stdin).get('buckets', [])]
if len(names) != 1:
    sys.exit(f'expected one Firebase Storage bucket, found {names}')
print(names[0])"
}

SRC_BUCKET="$(storage_bucket "$SRC")"
DST_BUCKET="$(storage_bucket "$DST")"
[[ "$SRC_BUCKET" != "$DST_BUCKET" ]] || die "source and target buckets are the same"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP="$(mktemp -d)"
chmod 700 "$TMP"
trap 'rm -rf "$TMP"' EXIT # user exports (emails, password hashes) never outlive the run

require_buckets() {
  [[ -n "$TRANSFER_BUCKET" ]] || die "--transfer-bucket is required"
  [[ -n "$BACKUP_BUCKET" ]] || die "--backup-bucket is required"
  assert_not_prod_bucket "$BACKUP_BUCKET"
}

firestore_counts() { # prints "collection count" for each top-level collection
  local p="$1" base="https://firestore.googleapis.com/v1/projects/$1/databases/(default)/documents"
  api "$p" POST "$base:listCollectionIds" '{"pageSize":300}' |
    python3 -c "import json,sys; print('\n'.join(json.load(sys.stdin).get('collectionIds',[])))" |
    while read -r c; do
      [[ -n "$c" ]] || continue
      n=$(api "$p" POST "$base:runAggregationQuery" \
        "{\"structuredAggregationQuery\":{\"structuredQuery\":{\"from\":[{\"collectionId\":\"$c\"}]},\"aggregations\":[{\"alias\":\"n\",\"count\":{}}]}}" |
        python3 -c "import json,sys; print(json.load(sys.stdin)[0]['result']['aggregateFields']['n']['integerValue'])")
      echo "$c $n"
    done
}
storage_count() { gcloud storage ls -r "gs://$1/**" 2>/dev/null | grep -c . || true; }
auth_count() { # exports to the private temp dir, counts, deletes
  firebase auth:export "$TMP/count.json" --format=json --project "$1" >/dev/null
  python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))['users']))" "$TMP/count.json"
  rm -f "$TMP/count.json"
}

log "source (read only): production project, bucket $SRC_BUCKET"
log "target (modified):  test project $DST, bucket $DST_BUCKET"
$APPLY || log "dry run — pass --apply to make changes"

case "$PHASE" in
  check)
    log "gcloud account: $(gcloud config get-value account 2>/dev/null)"
    for p in "$SRC" "$DST"; do
      log "$p: billing=$(gcloud billing projects describe "$p" --format='value(billingEnabled)')," \
        "firestore=$(gcloud firestore databases describe --database='(default)' --project "$p" --format='value(locationId)')"
    done
    [[ -z "$TRANSFER_BUCKET" ]] || log "transfer bucket: $(gcloud storage buckets describe "gs://$TRANSFER_BUCKET" --format='value(location)')"
    [[ -z "$BACKUP_BUCKET" ]] || log "backup bucket:   $(gcloud storage buckets describe "gs://$BACKUP_BUCKET" --format='value(location)')"
    ;;

  backup)
    require_buckets
    assert_not_prod "$DST"
    log "plan: export test Firestore -> gs://$BACKUP_BUCKET/test-firestore-$STAMP"
    log "plan: copy test Storage     -> gs://$BACKUP_BUCKET/test-storage-$STAMP"
    if $APPLY; then
      gcloud firestore export "gs://$BACKUP_BUCKET/test-firestore-$STAMP" --project "$DST"
      gcloud storage rsync -r "gs://$DST_BUCKET" "gs://$BACKUP_BUCKET/test-storage-$STAMP"
    fi
    ;;

  firestore)
    require_buckets
    assert_not_prod "$DST"
    EXPORT="gs://$TRANSFER_BUCKET/prod-firestore-$STAMP"
    log "plan: export production Firestore (read) -> $EXPORT"
    log "plan: delete ALL collections in test Firestore ($DST)"
    log "plan: import $EXPORT -> test Firestore ($DST)"
    if $APPLY; then
      gcloud firestore export "$EXPORT" --project "$SRC"
      # The target's Firestore service agent must read the export, and that has to be in
      # place BEFORE the wipe — otherwise a failed import leaves the test database empty.
      AGENT="service-$(gcloud projects describe "$DST" --format='value(projectNumber)')@gcp-sa-firestore.iam.gserviceaccount.com"
      for role in roles/storage.objectViewer roles/storage.legacyBucketReader; do
        gcloud storage buckets add-iam-policy-binding "gs://$TRANSFER_BUCKET" \
          --member="serviceAccount:$AGENT" --role="$role" >/dev/null
      done
      assert_not_prod "$DST"
      firebase firestore:delete --all-collections --force --project "$DST"
      gcloud firestore import "$EXPORT" --project "$DST"
    fi
    ;;

  storage)
    assert_not_prod "$DST"
    assert_not_prod_bucket "$DST_BUCKET"
    if $APPLY; then
      gcloud storage rsync -r --delete-unmatched-destination-objects "gs://$SRC_BUCKET" "gs://$DST_BUCKET"
    else
      gcloud storage rsync -r --delete-unmatched-destination-objects --dry-run \
        "gs://$SRC_BUCKET" "gs://$DST_BUCKET" 2>&1 | tee "$TMP/rsync.log" >/dev/null || true
      log "dry run: $(grep -c 'Would copy' "$TMP/rsync.log" || true) to copy," \
        "$(grep -c 'Would remove' "$TMP/rsync.log" || true) to remove"
      if grep 'Would remove' "$TMP/rsync.log" | grep -v "gs://$DST_BUCKET/" | grep -q .; then
        die "dry run would remove files outside the test bucket"
      fi
      log "all removals are inside gs://$DST_BUCKET"
    fi
    ;;

  auth)
    assert_not_prod "$DST"
    log "plan: export production users (read), delete all test users, import production users"
    if $APPLY; then
      firebase auth:export "$TMP/prod-users.json" --format=json --project "$SRC"
      api "$SRC" GET "https://identitytoolkit.googleapis.com/admin/v2/projects/$SRC/config" \
        >"$TMP/prod-config.json"
      firebase auth:export "$TMP/test-users.json" --format=json --project "$DST"
      assert_not_prod "$DST"
      python3 - "$TMP/test-users.json" >"$TMP/test-uids.txt" <<'PY'
import json, sys
for u in json.load(open(sys.argv[1]))["users"]:
    print(u["localId"])
PY
      # identitytoolkit batchDelete takes up to 1000 ids per call
      split -l 1000 "$TMP/test-uids.txt" "$TMP/uids-"
      for chunk in "$TMP"/uids-*; do
        [[ -s "$chunk" ]] || continue
        body=$(python3 -c "import json,sys; print(json.dumps({'localIds':open(sys.argv[1]).read().split(),'force':True}))" "$chunk")
        api "$DST" POST "https://identitytoolkit.googleapis.com/v1/projects/$DST/accounts:batchDelete" "$body" >/dev/null
      done
      read -r ALGO KEY SEP ROUNDS MEM < <(python3 - "$TMP/prod-config.json" <<'PY'
import json, sys
h = json.load(open(sys.argv[1]))["signIn"]["hashConfig"]
print(h["algorithm"], h["signerKey"], h["saltSeparator"], h["rounds"], h["memoryCost"])
PY
      )
      firebase auth:import "$TMP/prod-users.json" --project "$DST" \
        --hash-algo="$ALGO" --hash-key="$KEY" --salt-separator="$SEP" \
        --rounds="$ROUNDS" --mem-cost="$MEM"
    fi
    ;;

  verify)
    log "Firestore documents per collection (production | test):"
    join -a1 -a2 -e0 -o0,1.2,2.2 <(firestore_counts "$SRC" | sort) <(firestore_counts "$DST" | sort) |
      awk '{ printf "    %-28s %6s | %-6s %s\n", $1, $2, $3, ($2==$3 ? "" : "<- differs") }'
    log "Storage files: production $(storage_count "$SRC_BUCKET") | test $(storage_count "$DST_BUCKET")"
    log "Auth users:    production $(auth_count "$SRC") | test $(auth_count "$DST")"
    ;;

  *)
    sed -n '2,30p' "$0"
    exit 2
    ;;
esac
log "done: $PHASE"
