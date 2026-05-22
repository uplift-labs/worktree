# worktree

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **This is a personal pet project. Use at your own risk.**

Git worktree isolation and automatic cleanup for OpenCode sessions. Keeps `main` untouched, routes supported OpenCode tools into a session worktree, and cleans up stale worktrees. The runtime is TypeScript-first and requires Node.js `24+` plus `git`.

## Quickstart

Install into your project:

```powershell
git clone --depth 1 --branch v2.0.0 https://github.com/uplift-labs/worktree.git
node worktree/install.ts --target .
opencode
```

Optional native OpenCode permission defaults:

```powershell
node worktree/install.ts --target . --with-opencode-permissions
opencode
```

Optional OS-level sandboxing for OpenCode `bash` tool calls on macOS/Linux:

```powershell
node worktree/install.ts --target . --with-opencode-os-sandbox
opencode
```

Your repo now has OpenCode worktree isolation. Every OpenCode session can get its own worktree, `main` is protected by a merge gate, and stale worktrees clean themselves up.

<details>
<summary>Manual core usage</summary>

```powershell
# Create a worktree from main
node .opencode/worktree/core/cmd/sandbox-init.ts `
  --repo "$PWD" `
  --session demo `
  --worktrees-dir .opencode/worktree/worktrees

# Merge back when ready from the main repo
git merge wt-demo

# Clean up stale completed worktrees
node .opencode/worktree/core/cmd/sandbox-lifecycle.ts `
  --repo "$PWD" `
  --worktrees-dir .opencode/worktree/worktrees
```

</details>

## The Problem

AI coding agents operate inside your git repository. Without guardrails, two things go wrong repeatedly:

1. **Main branch contamination.** The agent edits files directly on `main`, leaving half-finished work in the primary branch.
2. **Abandoned state accumulates.** Crashed or force-quit sessions leave stale worktrees, orphan branches, and marker files behind.

## How It Works

The tool creates a disposable **git worktree** for each OpenCode session, enforces a **merge gate** before anything reaches `main`, and runs **automatic cleanup** of stale state.

```text
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
- **No data loss.** Dirty or unmerged worktrees are preserved. Cleanup only removes merged clean worktrees or stale empty state.
- **No accumulation.** TTL-expired markers, merged branches, orphan branches, and empty directories are cleaned automatically on session start and cleanup paths.

## Architecture

```text
worktree/
├── core/
│   ├── cmd/         public TypeScript CLI commands
│   └── lib/         internal TypeScript helpers
├── adapters/
│   └── opencode/    OpenCode server + TUI plugins
├── install.ts
└── remote-install.ts
```

`core/` is the stable contract. CLI flags in, human-readable text out, fixed exit codes: `0` allow/success, `1` deny/failure with reason, `2` bad usage. Full spec lives in [`CONTRACT.md`](CONTRACT.md).

`adapters/opencode/` is the OpenCode integration. It translates OpenCode plugin hooks into calls to `core/cmd/*` and handles in-process tool path routing.

Installed copies live under `.opencode/worktree/`; project-local OpenCode plugin files live under `.opencode/`. Root `core/` and `adapters/opencode/` are the source of truth.

## Install

Local install:

```powershell
git clone https://github.com/uplift-labs/worktree
node worktree/install.ts --target /path/to/repo
```

Remote-style install without Bash:

```powershell
git clone --depth 1 --branch v2.0.0 https://github.com/uplift-labs/worktree.git
node worktree/remote-install.ts --ref v2.0.0
```

`remote-install.ts` clones the requested release into a temp directory and runs `install.ts`. For testing another branch or tag, pass `--ref <git-ref>` or set `WORKTREE_SANDBOX_REF`.

The installer copies `core/` to `.opencode/worktree/core/`, copies the OpenCode adapter to `.opencode/worktree/adapters/opencode/`, writes project-local plugins to `.opencode/plugins/` and `.opencode/tui-plugins/`, registers the TUI plugin in `.opencode/tui.json`, wires `pre-merge-commit` and `post-merge` git hooks, and ignores `.opencode/worktree/worktrees/`.

Re-running is safe. The `post-merge` hook re-runs `install.ts` in the background after every merge so installed copies stay in sync with source.

## OpenCode Adapter

The OpenCode adapter is plugin-first:

| Component | What it does |
|---|---|
| Server plugin | Loads from `.opencode/plugins/`, creates or detects a session worktree, injects system context, waits for worktree readiness before supported tool execution, maps supported tool paths into the worktree, blocks explicit main-repo write targets, refreshes markers, and schedules cleanup on `session.deleted` or process exit. |
| TUI plugin | Loads from `.opencode/tui.json`, adds a right-sidebar modified-files list from the worktree git diff, watches the worktree git `HEAD` for branch changes, and polls as a fallback. |

OpenCode does not expose a pre-bootstrap hook that mutates its internal project root, so the plugin virtualizes supported tool paths into the worktree. OpenCode's own footer/status may still show the original repo and branch; trust `OPENCODE_SANDBOX_WORKTREE`, tool working dirs, or `git status` run by the tool for active worktree state.

The TUI plugin reads the session worktree from `OPENCODE_SANDBOX_WORKTREE` or the session marker. Tune fallback polling with `AISB_OPENCODE_BRANCH_REFRESH_MS`, `AISB_OPENCODE_FILES_REFRESH_MS`, and `AISB_OPENCODE_GIT_TIMEOUT_MS`. Enable debug logs with `AISB_OPENCODE_BRANCH_DEBUG=1` or `AISB_OPENCODE_FILES_DEBUG=1`.

Optional native permission hardening is available with `--with-opencode-permissions`. It preserves existing user rules and only adds missing defaults: `external_directory` and `doom_loop` ask, `.env` reads are denied while `.env.example` remains allowed, and obviously destructive `bash` tool patterns such as hard resets, force pushes, and `rm -rf *` are denied.

Optional OS-level sandboxing is available with `--with-opencode-os-sandbox`. This adds the community `opencode-sandbox` npm plugin so OpenCode `bash` tool calls are wrapped by `@anthropic-ai/sandbox-runtime` on supported platforms. It does not replace worktree isolation.

OpenCode compatibility checklist: do not run with `OPENCODE_PURE=1` when verifying the adapter because pure mode skips project plugins; re-run `npm test` after OpenCode upgrades; recheck server hooks `event`, `tool.execute.before`, `shell.env`, `tool.definition`, and `experimental.chat.system.transform`; recheck TUI event names such as `session.status`, `file.edited`, `vcs.branch.updated`, and `session.next.*` if OpenCode changes its event bus.

## Git Hooks

Installed automatically by `install.ts`:

| Hook | Purpose |
|---|---|
| `pre-merge-commit` | Blocks merge if the worktree being merged has tracked modifications or untracked files. |
| `post-merge` | Re-runs `install.ts` in the background after every merge to keep `.opencode/worktree/` and `.opencode/` in sync. |

## CLI Reference

| Command | Purpose |
|---|---|
| `sandbox-init.ts` | Create a session worktree branched from `main` or `master`. |
| `sandbox-guard.ts` | Path gate: allow or deny an edit based on active worktree location. |
| `sandbox-lifecycle.ts` | Cleanup merged worktrees, stale markers, orphan branches, and residual dirs. |
| `sandbox-cleanup.ts` | Session cleanup: capture-commit pending work, self-release merged clean marker, then run lifecycle. |
| `sandbox-merge-gate.ts` | Pre-merge validation: block if the worktree has uncommitted changes. |
| `reflection-rescue.ts` | Best-effort rescue for Markdown sidecar files stranded inside preserved worktrees. |

## Testing

```powershell
npm ci
npm run typecheck
npm test
npm run verify
```

Tests cover core commands, installer behavior, and the OpenCode adapter. Test files create real temporary git repositories via Node's `fs.mkdtempSync` and `git init`.

## Platform Support

| Platform | Status |
|---|---|
| Windows | Supported with Node.js `24+`; Windows-specific code handles PID checks, path normalization, and background process quirks. |
| Linux | Supported with Node.js `24+`; OS-level sandbox option depends on platform helpers. |
| macOS | Supported with Node.js `24+`; OS-level sandbox option depends on platform helpers. |

## License

[MIT](LICENSE)
