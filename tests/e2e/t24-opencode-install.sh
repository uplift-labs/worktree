#!/bin/bash
# t24 — OpenCode install path smoke test.
set -u
SELF="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SELF/../.." && pwd)"
. "$ROOT/tests/lib/assert.sh"
. "$ROOT/tests/lib/fixture.sh"

fixture_init
trap fixture_cleanup EXIT

REPO=$(fixture_repo "t24")

echo "== install --with-opencode populates adapter and project plugin =="
OUT=$(bash "$ROOT/install.sh" --target "$REPO" --with-opencode 2>&1)
ec=$?
assert_exit "install exits 0" 0 "$ec"
assert_dir_absent "opencode legacy bin not installed" "$REPO/.uplift/sandbox/adapters/opencode/bin"
assert_dir_absent "opencode legacy lib not installed" "$REPO/.uplift/sandbox/adapters/opencode/lib"
assert_file_exists "opencode adapter plugin copied" "$REPO/.uplift/sandbox/adapters/opencode/plugins/worktree-sandbox.js"
assert_file_exists "opencode TUI branch plugin copied" "$REPO/.uplift/sandbox/adapters/opencode/tui/worktree-sandbox-branch.tsx"
assert_file_exists "opencode TUI branch core copied" "$REPO/.uplift/sandbox/adapters/opencode/tui/worktree-sandbox-branch-core.js"
assert_file_exists "project opencode plugin written" "$REPO/.opencode/plugins/worktree-sandbox.js"
assert_file_exists "project opencode TUI plugin written" "$REPO/.opencode/tui-plugins/worktree-sandbox-branch.tsx"
assert_file_exists "project opencode TUI core written" "$REPO/.opencode/tui-plugins/worktree-sandbox-branch-core.js"
assert_contains "project TUI config registers branch plugin" "worktree-sandbox-branch.tsx" "$(cat "$REPO/.opencode/tui.json")"
assert_contains "install output mentions opencode" "opencode adapter" "$OUT"

echo "== re-install updates managed plugin but preserves unrelated project plugins =="
printf 'user plugin\n' > "$REPO/.opencode/plugins/user-plugin.js"
mkdir -p "$REPO/.opencode/tui-plugins"
printf 'user tui plugin\n' > "$REPO/.opencode/tui-plugins/user-tui-plugin.tsx"
printf 'stale\n' > "$REPO/.uplift/sandbox/adapters/opencode/plugins/stale.js"
printf 'stale\n' > "$REPO/.uplift/sandbox/adapters/opencode/tui/stale.tsx"
mkdir -p "$REPO/.uplift/sandbox/adapters/opencode/bin" "$REPO/.uplift/sandbox/adapters/opencode/lib"
printf 'stale\n' > "$REPO/.uplift/sandbox/adapters/opencode/bin/stale.sh"
printf 'stale\n' > "$REPO/.uplift/sandbox/adapters/opencode/lib/layout.sh"
OUT=$(bash "$ROOT/install.sh" --target "$REPO" --with-opencode 2>&1)
ec=$?
assert_exit "re-install exits 0" 0 "$ec"
assert_file_absent "stale adapter plugin removed" "$REPO/.uplift/sandbox/adapters/opencode/plugins/stale.js"
assert_file_absent "stale adapter TUI plugin removed" "$REPO/.uplift/sandbox/adapters/opencode/tui/stale.tsx"
assert_dir_absent "stale opencode legacy bin removed" "$REPO/.uplift/sandbox/adapters/opencode/bin"
assert_dir_absent "stale opencode legacy lib removed" "$REPO/.uplift/sandbox/adapters/opencode/lib"
assert_file_exists "unrelated project plugin preserved" "$REPO/.opencode/plugins/user-plugin.js"
assert_file_exists "unrelated project TUI plugin preserved" "$REPO/.opencode/tui-plugins/user-tui-plugin.tsx"
assert_file_exists "managed project plugin still present" "$REPO/.opencode/plugins/worktree-sandbox.js"
TUI_PLUGIN_COUNT=$(grep -o 'worktree-sandbox-branch.tsx' "$REPO/.opencode/tui.json" | wc -l | tr -d '[:space:]')
assert_eq "managed TUI plugin not duplicated" "1" "$TUI_PLUGIN_COUNT"

echo "== install --with-opencode-os-sandbox merges npm plugin idempotently =="
cat > "$REPO/opencode.json" <<'JSON'
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["existing-plugin"]
}
JSON
OUT=$(bash "$ROOT/install.sh" --target "$REPO" --with-opencode-os-sandbox 2>&1)
ec=$?
assert_exit "opencode os sandbox install exits 0" 0 "$ec"
OPENCODE_JSON=$(cat "$REPO/opencode.json")
assert_contains "existing opencode plugin preserved" '"existing-plugin"' "$OPENCODE_JSON"
assert_contains "opencode-sandbox plugin added" '"opencode-sandbox"' "$OPENCODE_JSON"
assert_contains "install output mentions os sandbox" "opencode OS sandbox plugin" "$OUT"

OUT=$(bash "$ROOT/install.sh" --target "$REPO" --with-opencode-os-sandbox 2>&1)
ec=$?
assert_exit "opencode os sandbox reinstall exits 0" 0 "$ec"
OS_PLUGIN_COUNT=$(grep -o '"opencode-sandbox"' "$REPO/opencode.json" | wc -l | tr -d '[:space:]')
assert_eq "opencode-sandbox plugin not duplicated" "1" "$OS_PLUGIN_COUNT"

echo "== post-merge hook preserves --with-opencode flag =="
GIT_COMMON=$(git -C "$REPO" rev-parse --git-common-dir)
assert_contains "post-merge detects opencode" "--with-opencode" "$(cat "$REPO/$GIT_COMMON/hooks/post-merge")"
assert_contains "post-merge detects opencode os sandbox" "--with-opencode-os-sandbox" "$(cat "$REPO/$GIT_COMMON/hooks/post-merge")"

test_summary
