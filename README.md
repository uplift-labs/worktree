# worktree-sandbox

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **This is a personal pet project. Use at your own risk.**

Git worktree isolation and automatic cleanup for OpenCode sessions. Keeps `main` untouched, routes supported OpenCode tools into a session worktree, and cleans up stale sandboxes. Core runtime has zero dependencies beyond `bash` and `git`.

## Quickstart

Install into your project:

```bash
bash <(curl -sSL https://raw.githubusercontent.com/uplift-labs/worktree-sandbox/v1.1.0/remote-install.sh)
opencode
```

Optional native OpenCode permission defaults:

```bash
bash <(curl -sSL https://raw.githubusercontent.com/uplift-labs/worktree-sandbox/v1.1.0/remote-install.sh) --with-opencode-permissions
opencode
```

Optional OS-level sandboxing for OpenCode `bash` commands on macOS/Linux:

```bash
bash <(curl -sSL https://raw.githubusercontent.com/uplift-labs/worktree-sandbox/v1.1.0/remote-install.sh) --with-opencode-os-sandbox
opencode
```

That's it. Your repo now has OpenCode sandbox isolation. Every OpenCode session gets its own worktree, `main` is protected by a merge gate, and stale sandboxes clean themselves up.

<details>
<summary>Manual core usage</summary>

```bash
# Create a sandbox from main
bash .uplift/sandbox/core/cmd/sandbox-init.sh \
  --repo "$PWD" \
  --session demo \
  --worktrees-dir .uplift/sandbox/worktrees
cd .uplift/sandbox/worktrees/wt-demo

# Work freely
echo "hello" > feature.txt
git add feature.txt && git commit -m "feat: add feature"

# Merge back when ready
cd /path/to/repo
git merge wt-demo

# Clean up stale completed worktrees
bash .uplift/sandbox/core/cmd/sandbox-lifecycle.sh \
  --repo "$PWD" \
  --worktrees-dir .uplift/sandbox/worktrees
```

</details>

## The Problem

AI coding agents operate inside your git repository. Without guardrails, two things go wrong repeatedly:

1. **Main branch contamination.** The agent edits files directly on `main`, leaving half-finished work in the primary branch.
2. **Abandoned state accumulates.** Crashed or force-quit sessions leave stale worktrees, orphan branches, and marker files behind.

## How It Works

The tool creates a disposable **git worktree** for each OpenCode session, enforces a **merge gate** before anything reaches `main`, and runs **automatic cleanup** of stale state.

```
main (protected)          wt-abc123... (worktree)
|                         |
|  merge gate             |  OpenCode tools run here
|  - dirty? block         |  - edits, commits, experiments
|  - clean? allow         |  - main is never edited directly
|                         |
v                         v
after merge: lifecycle removes merged clean worktrees, branches, and markers
```

Three guarantees:

- **Isolation.** Every OpenCode session gets its own worktree branched from `main`; supported OpenCode tools are routed into that worktree.
- **No data loss.** Dirty or unmerged sandboxes are preserved. Cleanup only removes merged clean worktrees or stale empty state.
- **No accumulation.** TTL-expired markers, merged branches, orphan branches, and empty directories are cleaned automatically on session start and cleanup paths.

## Architecture

```
worktree-sandbox/
├── core/
│   ├── cmd/         public CLI scripts
│   └── lib/         internal shell helpers
├── adapters/
│   └── opencode/    OpenCode server + TUI plugins
└── install.sh
```

`core/` is the stable contract. CLI flags in, human-readable text out, fixed exit codes: `0` allow/success, `1` deny/failure with reason, `2` bad usage. Full spec lives in [`CONTRACT.md`](CONTRACT.md).

`adapters/opencode/` is the OpenCode integration. It translates OpenCode plugin hooks into calls to `core/cmd/*` and handles in-process tool path routing.

Installed copies live under `.uplift/sandbox/`; project-local OpenCode plugin files live under `.opencode/`. Root `core/` and `adapters/opencode/` are the source of truth.

## Install

Remote install:

```bash
bash <(curl -sSL https://raw.githubusercontent.com/uplift-labs/worktree-sandbox/v1.1.0/remote-install.sh)
```

`remote-install.sh` clones the same release by default (`v1.1.0`). For testing another branch or tag, pass `--ref <git-ref>` or set `WORKTREE_SANDBOX_REF`.

Local install:

```bash
git clone https://github.com/uplift-labs/worktree-sandbox
bash worktree-sandbox/install.sh --target /path/to/repo
```

The installer copies `core/` to `.uplift/sandbox/core/`, copies the OpenCode adapter to `.uplift/sandbox/adapters/opencode/`, writes project-local plugins to `.opencode/plugins/` and `.opencode/tui-plugins/`, registers the TUI plugin in `.opencode/tui.json`, wires `pre-merge-commit` and `post-merge` git hooks, and ignores `.uplift/sandbox/worktrees/`.

Re-running is safe. The `post-merge` hook re-runs `install.sh` in the background after every merge so installed copies stay in sync with source.

## OpenCode Adapter

The OpenCode adapter is plugin-first:

| Component | What it does |
|---|---|
| Server plugin | Loads from `.opencode/plugins/`, creates or detects a session sandbox, injects system context, waits for sandbox readiness before supported tool execution, maps supported tool paths into the sandbox, blocks explicit main-repo write targets, refreshes markers, and schedules cleanup on `session.deleted` or process exit. |
| TUI plugin | Loads from `.opencode/tui.json`, adds a right-sidebar `Sandbox Modified Files` list from the sandbox git diff, watches the sandbox git `HEAD` for branch changes, and polls as a fallback. |

OpenCode does not expose a pre-bootstrap hook that mutates its internal project root, so the plugin virtualizes supported tool paths into the sandbox. OpenCode's own footer/status may still show the original repo and branch; trust `OPENCODE_SANDBOX_WORKTREE`, tool working dirs, or `git status` run by the tool for active sandbox state.

The TUI plugin reads the session sandbox worktree from `OPENCODE_SANDBOX_WORKTREE` or the session marker. Tune fallback polling with `AISB_OPENCODE_BRANCH_REFRESH_MS`, `AISB_OPENCODE_FILES_REFRESH_MS`, and `AISB_OPENCODE_GIT_TIMEOUT_MS`. Enable debug logs with `AISB_OPENCODE_BRANCH_DEBUG=1` or `AISB_OPENCODE_FILES_DEBUG=1`.

Optional native permission hardening is available with `--with-opencode-permissions`. It preserves existing user rules and only adds missing defaults: `external_directory` and `doom_loop` ask, `.env` reads are denied while `.env.example` remains allowed, and obviously destructive `bash` patterns such as hard resets, force pushes, and `rm -rf *` are denied.

Optional OS-level sandboxing is available with `--with-opencode-os-sandbox`. This adds the community `opencode-sandbox` npm plugin so OpenCode `bash` tool calls are wrapped by `@anthropic-ai/sandbox-runtime` on supported platforms. It does not replace worktree isolation.

OpenCode compatibility checklist: do not run with `OPENCODE_PURE=1` when verifying the adapter because pure mode skips project plugins; re-run `bash tests/run.sh tests/e2e/t23-opencode-adapter-smoke.sh` after OpenCode upgrades; recheck server hooks `event`, `tool.execute.before`, `shell.env`, `tool.definition`, and `experimental.chat.system.transform`; recheck TUI event names such as `session.status`, `file.edited`, `vcs.branch.updated`, and `session.next.*` if OpenCode changes its event bus.

## Git Hooks

Installed automatically by `install.sh`:

| Hook | Purpose |
|---|---|
| `pre-merge-commit` | Blocks merge if the sandbox worktree being merged has tracked modifications or untracked files. |
| `post-merge` | Re-runs `install.sh` in the background after every merge to keep `.uplift/sandbox/` and `.opencode/` in sync. |

## CLI Reference

| Command | Purpose |
|---|---|
| `sandbox-init.sh` | Create a session sandbox worktree branched from `main` or `master`. |
| `sandbox-guard.sh` | Path gate: allow or deny an edit based on active sandbox location. |
| `sandbox-lifecycle.sh` | Cleanup merged worktrees, stale markers, orphan branches, and residual dirs. |
| `sandbox-cleanup.sh` | Session cleanup: capture-commit pending work, self-release merged clean marker, then run lifecycle. |
| `sandbox-merge-gate.sh` | Pre-merge validation: block if the sandbox worktree has uncommitted changes. |
| `reflection-rescue.sh` | Best-effort rescue for Markdown sidecar files stranded inside preserved sandbox worktrees. |

## Testing

```bash
bash tests/run.sh               # all tests
bash tests/run.sh unit          # unit only
bash tests/run.sh e2e           # e2e only
bash tests/run.sh tests/e2e/t23-opencode-adapter-smoke.sh
```

Tests cover core commands, lifecycle behavior, installer behavior, and the OpenCode adapter. Test files create real temporary git repositories via `mktemp -d` and `git init`.

## Platform Support

| Platform | Status |
|---|---|
| Windows (Git Bash / MSYS) | Supported. Windows-specific code handles PID checks, path normalization, and background process quirks. |
| Linux | Supported by the shell runtime; OS-level sandbox option depends on platform helpers. |
| macOS | Supported by the shell runtime; OS-level sandbox option depends on platform helpers. |
| Windows (PowerShell native) | Not supported. Use Git Bash or WSL. |

## License

[MIT](LICENSE)
