# Public CLI Contract

Every TypeScript file under `core/cmd/` is a stable public entry point. Files under `core/lib/` are internal helpers and may change without notice.

## Conventions

- **Runtime:** Node.js `24+` executing TypeScript files directly.
- **Invocation:** `node core/cmd/<command>.ts ...`.
- **Input:** CLI flags and env vars only. No JSON on stdin.
- **Output:** human-readable text on stdout. No JSON unless explicitly noted.
- **Exit codes:** `0` = success / allow, `1` = blocked / failure with reason on stdout, `2` = bad usage.
- **Fail-open policy:** when git context cannot be resolved, commands exit `0` silently. They are safety nets, not gatekeepers.
- **Marker storage:** `<git-common-dir>/sandbox-markers/<safe-session-id>`. The safe session id is the caller-provided session id with any character outside `[A-Za-z0-9-]` replaced by `-`, preventing path traversal while preserving deterministic lookup. Marker fields are `branch epoch initial_head`. Markers are auto-expired via TTL.
- **Heartbeat sidecar:** `<marker-path>.hb`. Format: `<heartbeat_pid> <parent_winpid|0> <monitored_pid|0>`. Field 1 is the heartbeat PID. Field 2 is the native Windows PID of the owning process when known. Field 3 is the Unix PID monitored via `process.kill(pid, 0)` when known. The heartbeat touches the marker while the owning process is alive; when the owner dies, it invokes `sandbox-cleanup.ts` for immediate session cleanup.
- **Worktree location:** source CLI default is `<repo-root>/.sandbox/worktrees/<branch-name>`. Installed OpenCode integration passes `<repo-root>/.uplift/sandbox/worktrees/<branch-name>` explicitly.

## Commands

### `sandbox-init`

Create a session sandbox worktree.

```powershell
node core/cmd/sandbox-init.ts --repo <dir> --session <id> [--base <branch>] [--worktrees-dir <rel>] [--branch-prefix <prefix>]
```

| Flag | Required | Description |
|---|---|---|
| `--repo` | yes | Absolute path to the main repo. Must be on `main` or `master`. |
| `--session` | yes | Unique session identifier. Used for branch and marker names. |
| `--base` | no | Base branch to fork from. Defaults to detected main branch. |
| `--worktrees-dir` | no | Worktree directory relative to repo root. Default: `.sandbox/worktrees`. |
| `--branch-prefix` | no | Branch name prefix. Default: `wt`. |

Output: absolute sandbox path on stdout on success.

Exit: `0` success or benign no-op, `1` hard failure with message, `2` bad usage.

### `sandbox-guard`

Path gate: decide whether an edit at `<file>` is allowed.

```powershell
node core/cmd/sandbox-guard.ts --session <id> --file <path> [--repo <dir>] [--worktrees-dir <rel>]
```

Allow when there is no active sandbox, the file is inside the session sandbox, or the file is outside the repo. Deny when the file is inside the main repo but outside the session sandbox.

Exit: `0` allow, `1` deny with reason on stdout, `2` bad usage.

### `sandbox-lifecycle`

Periodic cleanup.

```powershell
node core/cmd/sandbox-lifecycle.ts --repo <dir> [--ttl <seconds>] [--branch-prefix <glob>] [--worktrees-dir <rel>]
```

| Flag | Required | Description |
|---|---|---|
| `--repo` | yes | Main repo path. |
| `--ttl` | no | Marker TTL in seconds for stale reclaim. Default: `5`. |
| `--branch-prefix` | no | Glob for orphan branch sweep. Default: `wt-*`. |
| `--worktrees-dir` | no | Worktree directory relative to repo root. Default: `.sandbox/worktrees`. |

Phases: reflection rescue, git worktree metadata prune, TTL marker reclaim with heartbeat owner checks, proactive marker release for merged clean sandboxes, merged worktree cleanup, orphan branch sweep, residual dir sweep.

Hardcoded timing constants:

| Constant | Value | Purpose |
|---|---|---|
| `ORPHAN_HB_GRACE` | `7200`s | Grace period for heartbeats with unknown owner before treating them as orphans. |
| `FRESH_SESSION_TTL` | `300`s | Extended TTL for sessions that never committed, protecting live sessions whose heartbeat died early. |

Exit: always `0`. Prints a multi-line report on stdout if any action was taken; silent otherwise.

### `sandbox-cleanup`

Session cleanup: capture-commit pending work, self-release merged clean marker, then lifecycle.

```powershell
node core/cmd/sandbox-cleanup.ts --repo <dir> --session <id> [--trust-dead] [--worktrees-dir <rel>] [--branch-prefix <glob>]
```

| Flag | Required | Description |
|---|---|---|
| `--repo` | yes | Main repo path. |
| `--session` | yes | Session identifier. |
| `--trust-dead` | no | Treat the owning session as definitely ended. Intended for OpenCode session deletion and process-exit cleanup paths. |
| `--worktrees-dir` | no | Worktree directory relative to repo root. Default: `.sandbox/worktrees`. |
| `--branch-prefix` | no | Glob for orphan branch sweep. Default: `wt-*`. |

Phases: capture-commit pending work unless merge/rebase/detached HEAD state is in progress, self-release marker if branch is merged into main and worktree is clean, refresh surviving marker, invoke `sandbox-lifecycle`.

Exit: always `0` (fail-open). Diagnostic output goes to stderr.

### `reflection-rescue`

Best-effort sidecar rescue for files written inside sandbox worktrees that need to land in the main repo even when the sandbox is preserved.

```powershell
node core/cmd/reflection-rescue.ts --repo <dir> [--worktrees-dir <rel>]
```

Environment: `REFLECTION_RESCUE_DIR` sets the relative sidecar directory to scan and copy into main. Default: `.reinforce/reflections`. Only `*.md` files in that directory are rescued. Existing main copies win and duplicate worktree copies are removed.

Exit: always `0` after argument validation. Missing repos, missing worktrees, and copy/delete failures fail open.

### `sandbox-merge-gate`

Pre-merge validation. Called from the installed `pre-merge-commit` git hook.

```powershell
node core/cmd/sandbox-merge-gate.ts --worktree <dir>
```

Blocks merge if the sandbox worktree has tracked modifications or untracked files.

Exit: `0` ok to merge, `1` blocked with reason on stdout, `2` bad usage.

## OpenCode Adapter Responsibilities

OpenCode support is plugin-first:

| Component | Role |
|---|---|
| OpenCode server plugin | Loads from `.opencode/plugins/`, schedules sandbox detection/creation on `session.created` or the first session-aware hook, injects system context, waits for sandbox readiness before supported tool execution, propagates sandbox env vars via `shell.env`, maps supported built-in tool paths into the session sandbox, blocks explicit main-repo write targets in-process, refreshes markers, and schedules `sandbox-cleanup.ts --trust-dead` on `session.deleted` or process exit. |
| OpenCode TUI plugin | Loads from `.opencode/tui.json`, renders a `Sandbox Modified Files` list from the sandbox git diff, refreshes branch metadata from git `HEAD` filesystem events when available, subscribes to OpenCode bus events, and uses async git/filesystem refreshes to avoid blocking the UI. |
| `--with-opencode-permissions` install option | Idempotently merges conservative native OpenCode permission defaults into root `opencode.json` without overwriting existing user rules. |
| `--with-opencode-os-sandbox` install option | Adds the external `opencode-sandbox` npm plugin to root `opencode.json`. |

OpenCode does not expose a pre-bootstrap hook that mutates its already-created instance `directory` or `worktree`. The plugin therefore virtualizes supported built-in tool paths into the sandbox instead of moving the process cwd. Sandbox bootstrap is asynchronous: prompt/system hooks may report a pending sandbox, but supported tool hooks must wait for readiness before mapping paths or injecting shell env.

The installed server plugin default export is `{ id: "uplift.worktree-sandbox", server: WorktreeSandbox }`. The named `WorktreeSandbox` export remains available for smoke tests.

OpenCode compatibility checks belong in tests whenever OpenCode is upgraded: verify `event`, `tool.execute.before`, `shell.env`, `tool.definition`, `experimental.chat.system.transform`, TUI event names, and local project plugin loading. `OPENCODE_PURE=1` skips project plugins and is not a valid adapter verification mode.

The OS sandbox option is adapter configuration only. It wraps OpenCode `bash` tool calls through `@anthropic-ai/sandbox-runtime` on supported platforms and passes through unsandboxed on unsupported setups. It does not change `core/cmd/*` behavior or exit codes.

## Git Hooks Installed By `install.ts`

| Hook | Purpose |
|---|---|
| `pre-merge-commit` | Gates sandbox merges via `sandbox-merge-gate`; validates worktree cleanliness of the branch being merged. |
| `post-merge` | Re-runs `install.ts` after every merge so installed sandbox scripts and OpenCode plugin copies stay in sync with source. Runs in background and fails open. |

## Library Functions

Source files under `core/lib/` are not part of the public contract. They are documented in their own module comments or tests for internal reference.
