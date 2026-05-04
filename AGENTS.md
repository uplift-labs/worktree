# AGENTS.md

This repo also uses `CLAUDE.md`; read it before code edits. This file is the compact OpenCode addendum, not a replacement for `CLAUDE.md` or `CONTRACT.md`.

## Worktree Discipline

- During OpenCode sessions, `OPENCODE_SANDBOX_WORKTREE` is the active project root; do file reads/edits there, not in the main checkout.
- OpenCode may still display the original repo/branch because the plugin virtualizes supported tool paths into the sandbox. Trust `OPENCODE_SANDBOX_WORKTREE`, tool working dirs, and `git status` run from the tool.
- When the user asks to land, ship, upload, or fix changes in `main`, complete the path: verify, commit, merge or fast-forward `main`, push, then dogfood the installed/current state when feasible.
- Do not leave completed work only in a sandbox branch unless the user explicitly asks for a sandbox-only change or a blocker prevents landing. If blocked, report the blocker and the safest next command.

## Commands

- `bash tests/run.sh` runs all tests. On Windows/Git Bash use a timeout of at least `900000` ms; `300000` ms is too short.
- If PowerShell resolves `bash` to WSL instead of Git Bash, invoke Git Bash explicitly: `& "C:\Program Files\Git\bin\bash.exe" tests/run.sh unit`.
- `bash tests/run.sh unit`, `bash tests/run.sh e2e`, and `bash tests/run.sh tests/e2e/t23-opencode-adapter-smoke.sh` run focused suites/files. There is no per-assert selector.
- `bash install.sh --target "$PWD" --with-opencode` syncs this repo's dogfood install under `.uplift/sandbox/` and `.opencode/`; run it after touching `core/`, `adapters/opencode/`, or installer code.
- `bash install.sh --target <repo> [--with-claude-code|--with-codex|--with-opencode|--with-opencode-os-sandbox]` is idempotent. Adapter JSON/TUI config merges require `python3`; `--with-opencode-os-sandbox` implies `--with-opencode`.
- There is no package-manager build step or CI workflow in the repo; verification is the Bash test runner plus installer dogfooding when source/adapter copies change.

## Source Boundaries

- `core/cmd/*.sh` are the stable public CLI. Flags, stdout shape, and exit codes are the contract in `CONTRACT.md`.
- `core/lib/*.sh` and `core/lib/json-merge.py` are internal. Do not source them from adapters or external callers.
- `adapters/<host>/` are thin translators from host hook input to `core/cmd/*`; add host-specific parsing there, not in `core/`.
- Root `core/` and `adapters/` are the source of truth. `.uplift/sandbox/*` and `.opencode/*` plugin files are installed mirrors used for dogfooding; sync them with `install.sh` instead of hand-editing unless testing installer output.

## Contracts

- Core exit codes are fixed: `0` allow/success, `1` deny/failure with reason on stdout, `2` bad usage. Preserve the fail-open policy when git context cannot be resolved.
- Changing any `core/cmd/` flag, output, exit code, marker format, or lifecycle phase requires updating `CONTRACT.md` and tests in the same change.
- Markers live at `<git-common-dir>/sandbox-markers/<session-id>` with fields `branch epoch initial_head`; `ttl-marker.sh` owns marker reads/writes.
- Worktree defaults differ by context: source CLI default is `.sandbox/worktrees`, installed adapters pass `.uplift/sandbox/worktrees` explicitly.

## Lifecycle And Hooks

- `sandbox-lifecycle.sh` order is load-bearing: reflection rescue, `git worktree prune`, TTL marker reclaim, proactive marker release, merged worktree cleanup, orphan branch sweep, residual dir sweep.
- `Stop`/idle hooks are heartbeat-only. Cleanup belongs to Claude `SessionEnd`, the Codex launcher exit path, OpenCode `session.deleted`/process exit, or heartbeat parent-death cleanup.
- Session cleanup capture-commits pending sandbox work but never merges to `main`; merging is always a deliberate user action protected by the merge gate.
- The installed `pre-merge-commit` hook validates cleanliness of the sandbox worktree being merged, not the target repo's merge-staged index. Keep non-sandbox/no-match cases fail-open.

## Shell And Tests

- Shebang is `#!/bin/bash`, never `#!/bin/sh`; PowerShell-native runtime is unsupported.
- Existing scripts often use `set -u` without `set -e`; do not add `set -euo pipefail` wholesale because nonzero `git`/`grep` exits are expected control flow.
- On MSYS/Git Bash, prefer `[[:space:]]` over `\s`; path-sensitive tests should follow the skip pattern in `tests/e2e/t08-custom-layout-flags.sh`.
- `.shellcheckrc` intentionally disables `SC1090`, `SC1091`, and `SC2034` for dynamic sources/documented vars. Keep shell scripts shellcheck-clean when `shellcheck` is available.
- Tests run each `*.sh` file as a standalone Bash script with real temp git repos from `mktemp -d` + `git init`. Shared helpers live only in `tests/lib/assert.sh` and `tests/lib/fixture.sh`.

## Finish Loop

- After making repository changes, dogfood before reporting completion: run the relevant test/install/verification cycle for the touched area, and state the exact commands and results.
- For the full test suite on Windows/Git Bash, run `tests/run.sh` with a timeout of at least `900000` ms. `300000` ms is too short and causes avoidable reruns.
