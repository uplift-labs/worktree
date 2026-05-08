#!/bin/bash
# Unit tests for safe marker filenames derived from hostile session ids.

set -u
SELF="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SELF/../.." && pwd)"
. "$ROOT/tests/lib/assert.sh"
. "$ROOT/tests/lib/fixture.sh"
. "$ROOT/core/lib/ttl-marker.sh"

fixture_init
trap fixture_cleanup EXIT

echo "== unsafe session id stays inside sandbox-markers =="
REPO=$(fixture_repo "marker-safety")
SESSION='../escape\\name'
SAFE=$(sb_marker_safe_id "$SESSION")

SB=$(bash "$ROOT/core/cmd/sandbox-init.sh" --repo "$REPO" --session "$SESSION" 2>&1)
ec=$?
assert_exit "sandbox-init succeeds" 0 "$ec"
assert_dir_exists "sandbox created" "$SB"
assert_file_exists "safe marker exists" "$REPO/.git/sandbox-markers/$SAFE"
assert_file_absent "raw traversal marker not created" "$REPO/.git/escape\\name"

echo "== guard and cleanup find the sanitized marker from raw session id =="
OUT=$(bash "$ROOT/core/cmd/sandbox-guard.sh" --repo "$REPO" --session "$SESSION" --file "$REPO/README.md" 2>&1)
ec=$?
assert_exit "guard denies main repo target" 1 "$ec"
assert_contains "guard reason mentions sandbox" "sandbox-guard: edit blocked" "$OUT"

OUT=$(bash "$ROOT/core/cmd/sandbox-cleanup.sh" --repo "$REPO" --session "$SESSION" 2>&1)
ec=$?
assert_exit "cleanup remains fail-open" 0 "$ec"
assert_file_exists "marker still found after cleanup" "$REPO/.git/sandbox-markers/$SAFE"

echo "== legacy raw marker names without separators are still honored =="
REPO2=$(fixture_repo "marker-legacy")
LEGACY_SESSION="legacy_session"
SAFE_LEGACY=$(sb_marker_safe_id "$LEGACY_SESSION")
SB2=$(bash "$ROOT/core/cmd/sandbox-init.sh" --repo "$REPO2" --session "$LEGACY_SESSION" 2>&1)
ec=$?
assert_exit "legacy sandbox-init succeeds" 0 "$ec"
assert_dir_exists "legacy sandbox created" "$SB2"
mv "$REPO2/.git/sandbox-markers/$SAFE_LEGACY" "$REPO2/.git/sandbox-markers/$LEGACY_SESSION"

OUT=$(bash "$ROOT/core/cmd/sandbox-guard.sh" --repo "$REPO2" --session "$LEGACY_SESSION" --file "$REPO2/README.md" 2>&1)
ec=$?
assert_exit "guard finds legacy raw marker" 1 "$ec"
assert_contains "legacy guard reason mentions sandbox" "sandbox-guard: edit blocked" "$OUT"

test_summary
