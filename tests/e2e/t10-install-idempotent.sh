#!/bin/bash
# t10 — install.sh is idempotent and updating.
# Covers:
#   - Fresh install populates core + OpenCode adapter dirs.
#   - Re-running install.sh overwrites existing *.sh (latest source wins).
#   - Stale *.sh files in the install target that no longer exist in source
#     are removed on re-run (protects against silent drift after a rename
#     or deletion upstream).
#   - Runtime state under .uplift/sandbox/ (worktrees/, markers) is untouched.
set -u
SELF="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SELF/../.." && pwd)"
. "$ROOT/tests/lib/assert.sh"
. "$ROOT/tests/lib/fixture.sh"

fixture_init
trap fixture_cleanup EXIT

REPO=$(fixture_repo "t10")

echo "== first install populates core + OpenCode adapter =="
OUT=$(bash "$ROOT/install.sh" --target "$REPO" 2>&1)
ec=$?
assert_exit "install exits 0" 0 "$ec"
assert_file_exists "core lib copied"    "$REPO/.uplift/sandbox/core/lib/git-context.sh"
assert_file_exists "core cmd copied"    "$REPO/.uplift/sandbox/core/cmd/sandbox-init.sh"
assert_file_exists "opencode adapter plugin copied" "$REPO/.uplift/sandbox/adapters/opencode/plugins/worktree-sandbox.js"
assert_file_exists "opencode project plugin written" "$REPO/.opencode/plugins/worktree-sandbox.js"

echo "== install accepts linked worktree targets =="
LINKED=$(fixture_worktree "$REPO" "install-linked" "linked.txt" "linked")
OUT=$(bash "$ROOT/install.sh" --target "$LINKED" 2>&1)
ec=$?
assert_exit "linked worktree install exits 0" 0 "$ec"
assert_file_exists "linked worktree core copied" "$LINKED/.uplift/sandbox/core/cmd/sandbox-init.sh"
assert_file_exists "linked worktree opencode TUI copied" "$LINKED/.uplift/sandbox/adapters/opencode/tui/worktree-sandbox-branch.tsx"

echo "== seed stale files + runtime state, then re-run install =="
# Pretend an older version had these files that are no longer in source.
echo "# stale core lib" > "$REPO/.uplift/sandbox/core/lib/ghost-lib.sh"
echo "# stale core cmd" > "$REPO/.uplift/sandbox/core/cmd/ghost-cmd.sh"
mkdir -p "$REPO/.uplift/sandbox/adapter/hooks" "$REPO/.uplift/sandbox/adapters/old-agent"
echo "# stale legacy adapter hook" > "$REPO/.uplift/sandbox/adapter/hooks/ghost-hook.sh"
echo "# stale non-opencode adapter" > "$REPO/.uplift/sandbox/adapters/old-agent/ghost.sh"
# Runtime state that install MUST NOT touch.
mkdir -p "$REPO/.uplift/sandbox/worktrees/bogus-session"
echo "runtime" > "$REPO/.uplift/sandbox/worktrees/bogus-session/marker.txt"
mkdir -p "$REPO/.git/sandbox-markers"
echo "branch 123" > "$REPO/.git/sandbox-markers/sess-abc"

# Also mutate an installed file to confirm re-run actually overwrites.
echo "TAMPERED" > "$REPO/.uplift/sandbox/core/cmd/sandbox-init.sh"

OUT=$(bash "$ROOT/install.sh" --target "$REPO" 2>&1)
ec=$?
assert_exit "re-install exits 0" 0 "$ec"

echo "== stale files in managed dirs are gone =="
assert_file_absent "stale core lib removed"     "$REPO/.uplift/sandbox/core/lib/ghost-lib.sh"
assert_file_absent "stale core cmd removed"     "$REPO/.uplift/sandbox/core/cmd/ghost-cmd.sh"
assert_dir_absent "stale legacy adapter removed" "$REPO/.uplift/sandbox/adapter"
assert_dir_absent "stale non-opencode adapter removed" "$REPO/.uplift/sandbox/adapters/old-agent"

echo "== tampered file is restored to source content =="
REINSTALLED=$(head -1 "$REPO/.uplift/sandbox/core/cmd/sandbox-init.sh")
assert_not_contains "tampered file overwritten" "TAMPERED" "$REINSTALLED"
assert_contains "restored file has expected shebang" "#!/bin/bash" "$REINSTALLED"

echo "== runtime state is untouched =="
assert_dir_exists  "bogus worktree dir preserved" "$REPO/.uplift/sandbox/worktrees/bogus-session"
assert_file_exists "bogus worktree file preserved" "$REPO/.uplift/sandbox/worktrees/bogus-session/marker.txt"
assert_file_exists "marker preserved"              "$REPO/.git/sandbox-markers/sess-abc"

echo "== missing source dir is a fatal error (abort, no partial wipe) =="
# Build a minimal broken source tree with no core/lib/*.sh.
BROKEN_SRC=$(mktemp -d 2>/dev/null || mktemp -d -t sbx-broken)
mkdir -p "$BROKEN_SRC/core/lib" "$BROKEN_SRC/core/cmd" "$BROKEN_SRC/adapters/opencode/plugins" "$BROKEN_SRC/adapters/opencode/tui"
cp "$ROOT/install.sh" "$BROKEN_SRC/install.sh"
# No .sh files in core/lib — should abort before wiping.
OUT=$(bash "$BROKEN_SRC/install.sh" --target "$REPO" 2>&1)
ec=$?
assert_exit "broken source install fails" 1 "$ec"
assert_contains "error mentions missing source" "no \*.sh files" "$OUT"
# After the failed install, original files must still be present.
assert_file_exists "core lib survived failed install" "$REPO/.uplift/sandbox/core/lib/git-context.sh"
rm -rf "$BROKEN_SRC"

test_summary
