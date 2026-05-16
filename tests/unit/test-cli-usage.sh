#!/bin/bash
# Unit tests for controlled bad-usage errors on CLI flags missing values.

set -u
SELF="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SELF/../.." && pwd)"
. "$ROOT/tests/lib/assert.sh"

check_usage() {
  local name="$1"
  shift
  local out ec
  out=$("$@" 2>&1)
  ec=$?
  assert_exit "$name exits 2" 2 "$ec"
  assert_contains "$name prints usage" "[Uu]sage:" "$out"
  assert_not_contains "$name avoids set -u crash" "unbound variable" "$out"
}

echo "== core CLI missing flag values =="
check_usage "sandbox-init --repo" bash "$ROOT/core/cmd/sandbox-init.sh" --repo
check_usage "sandbox-guard --session" bash "$ROOT/core/cmd/sandbox-guard.sh" --session
check_usage "sandbox-lifecycle --repo" bash "$ROOT/core/cmd/sandbox-lifecycle.sh" --repo
check_usage "sandbox-cleanup --repo" bash "$ROOT/core/cmd/sandbox-cleanup.sh" --repo
check_usage "sandbox-merge-gate --worktree" bash "$ROOT/core/cmd/sandbox-merge-gate.sh" --worktree
check_usage "reflection-rescue --repo" bash "$ROOT/core/cmd/reflection-rescue.sh" --repo

echo "== installer missing flag values =="
check_usage "install --target" bash "$ROOT/install.sh" --target
check_usage "remote-install --ref" bash "$ROOT/remote-install.sh" --ref

test_summary
