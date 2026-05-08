#!/bin/bash
# remote-install.sh — fetch worktree-sandbox and install into the current repo.
#
# Usage:
#   bash <(curl -sSL https://raw.githubusercontent.com/uplift-labs/worktree-sandbox/main/remote-install.sh) [--ref <git-ref>] [--prefix <dir>] [--with-claude-code] [--with-codex] [--with-opencode] [--with-opencode-permissions] [--with-opencode-os-sandbox]
#
# Clones the repo into a temp directory, runs install.sh with forwarded args,
# and removes the temp directory. Requires git and curl/bash.
# Default --prefix is .uplift (installs to <target>/.uplift/sandbox).
# Default --ref is v1.1.0 so pinned remote-install URLs install the same release.

set -u

REPO_URL="https://github.com/uplift-labs/worktree-sandbox.git"
REPO_REF="${WORKTREE_SANDBOX_REF:-v1.1.0}"
FORWARD_ARGS=()

usage() { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; }
need_value() { [ "$#" -ge 2 ] && [ -n "$2" ] || { usage >&2; exit 2; }; }

while [ $# -gt 0 ]; do
  case "$1" in
    --ref) need_value "$@"; REPO_REF="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) FORWARD_ARGS+=("$1"); shift ;;
  esac
done

tmpdir=$(mktemp -d) || { printf 'remote-install: failed to create temp dir\n' >&2; exit 1; }
cleanup() { rm -rf "$tmpdir"; }
trap cleanup EXIT

printf '[remote-install] cloning worktree-sandbox %s...\n' "$REPO_REF"
if ! git clone --depth 1 --branch "$REPO_REF" --quiet "$REPO_URL" "$tmpdir/worktree-sandbox" 2>&1; then
  printf '[remote-install] git clone failed\n' >&2
  exit 1
fi

printf '[remote-install] running install.sh...\n'
bash "$tmpdir/worktree-sandbox/install.sh" "${FORWARD_ARGS[@]}"
