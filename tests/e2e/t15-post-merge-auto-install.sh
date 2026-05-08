#!/bin/bash
# t15 — post-merge hook auto-syncs .uplift/sandbox/ after merge.
# Covers:
#   - install.sh writes a post-merge hook
#   - After a merge, .uplift/sandbox/ core files are updated automatically
#   - Tampered installed files get restored by post-merge
#
# The post-merge hook calls $REPO_ROOT/install.sh, so this test mirrors
# the self-hosting layout: source tree (core/, adapters/, install.sh) lives
# at the repo root alongside .uplift/sandbox/.
set -u
SELF="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SELF/../.." && pwd)"
. "$ROOT/tests/lib/assert.sh"
. "$ROOT/tests/lib/fixture.sh"

wait_for_file() {
  local file="$1" i=0
  while [ "$i" -lt 50 ]; do
    [ -f "$file" ] && return 0
    sleep 0.1
    i=$((i + 1))
  done
  return 1
}

wait_for_file_not_contains() {
  local file="$1" pattern="$2" i=0
  while [ "$i" -lt 50 ]; do
    if [ -f "$file" ] && ! grep -q -- "$pattern" "$file" 2>/dev/null; then
      return 0
    fi
    sleep 0.1
    i=$((i + 1))
  done
  return 1
}

fixture_init
trap fixture_cleanup EXIT

echo "== install.sh creates post-merge hook =="
REPO=$(fixture_repo "t15")

# Mirror the self-hosting layout: copy source tree into the test repo
cp -r "$ROOT/core" "$REPO/core"
cp -r "$ROOT/adapters" "$REPO/adapters"
cp "$ROOT/install.sh" "$REPO/install.sh"
(cd "$REPO" && git add -A && git commit -q -m "chore: add source tree")

bash "$REPO/install.sh" --target "$REPO" --with-claude-code --with-codex >/dev/null 2>&1
GIT_COMMON=$(git -C "$REPO" rev-parse --git-common-dir 2>/dev/null)
case "$GIT_COMMON" in
  /*|[A-Za-z]:*) ;;
  *) GIT_COMMON="$REPO/$GIT_COMMON" ;;
esac

assert_file_exists "post-merge hook installed" "$GIT_COMMON/hooks/post-merge"

echo "== tamper installed file to detect re-sync =="
echo "TAMPERED" > "$REPO/.uplift/sandbox/core/lib/heartbeat.sh"
BEFORE=$(cat "$REPO/.uplift/sandbox/core/lib/heartbeat.sh")
assert_contains "file is tampered" "TAMPERED" "$BEFORE"

echo "== post-merge hook restores files after merge =="
# Create a feature branch, commit, and merge to trigger post-merge
(cd "$REPO" && git checkout -q -b feat-dummy)
echo "dummy" > "$REPO/dummy.txt"
(cd "$REPO" && git add dummy.txt && git commit -q -m "feat: dummy")
(cd "$REPO" && git checkout -q main && git merge -q feat-dummy --no-edit)

# post-merge runs in background; wait for managed files to settle.
wait_for_file_not_contains "$REPO/.uplift/sandbox/core/lib/heartbeat.sh" "TAMPERED" || true
wait_for_file "$REPO/.uplift/sandbox/adapters/codex/hooks/session-start.sh" || true

AFTER=$(head -1 "$REPO/.uplift/sandbox/core/lib/heartbeat.sh")
assert_not_contains "tampered file restored" "TAMPERED" "$AFTER"
assert_contains "restored file has shebang" "#!/bin/bash" "$AFTER"

echo "== post-merge detects --with-claude-code from existing adapter dir =="
assert_file_exists "adapter still present after post-merge" "$REPO/.uplift/sandbox/adapter/hooks/session-start.sh"
assert_file_exists "codex adapter still present after post-merge" "$REPO/.uplift/sandbox/adapters/codex/hooks/session-start.sh"

echo "== post-merge preserves custom --prefix =="
REPO2=$(fixture_repo "t15-prefix")
cp -r "$ROOT/core" "$REPO2/core"
cp -r "$ROOT/adapters" "$REPO2/adapters"
cp "$ROOT/install.sh" "$REPO2/install.sh"
(cd "$REPO2" && git add -A && git commit -q -m "chore: add source tree")

bash "$REPO2/install.sh" --target "$REPO2" --prefix .custom --with-codex >/dev/null 2>&1
GIT_COMMON2=$(git -C "$REPO2" rev-parse --git-common-dir 2>/dev/null)
case "$GIT_COMMON2" in
  /*|[A-Za-z]:*) ;;
  *) GIT_COMMON2="$REPO2/$GIT_COMMON2" ;;
esac
assert_contains "post-merge records custom prefix" "SANDBOX_PREFIX='.custom'" "$(cat "$GIT_COMMON2/hooks/post-merge")"

echo "TAMPERED" > "$REPO2/.custom/sandbox/core/lib/heartbeat.sh"
(cd "$REPO2" && git checkout -q -b feat-prefix)
echo "prefix" > "$REPO2/prefix.txt"
(cd "$REPO2" && git add prefix.txt && git commit -q -m "feat: prefix")
(cd "$REPO2" && git checkout -q main && git merge -q feat-prefix --no-edit)
wait_for_file_not_contains "$REPO2/.custom/sandbox/core/lib/heartbeat.sh" "TAMPERED" || true
wait_for_file "$REPO2/.custom/sandbox/adapters/codex/hooks/session-start.sh" || true

AFTER_PREFIX=$(head -1 "$REPO2/.custom/sandbox/core/lib/heartbeat.sh")
assert_not_contains "custom-prefix install restored tampered file" "TAMPERED" "$AFTER_PREFIX"
assert_contains "custom-prefix restored file has shebang" "#!/bin/bash" "$AFTER_PREFIX"
assert_dir_absent "default prefix not created by post-merge" "$REPO2/.uplift/sandbox/core"

# The hook runs install.sh in the background. Avoid deleting the temp repo while
# the final config merge steps are still closing file handles on Windows/MSYS.
sleep 1

test_summary
