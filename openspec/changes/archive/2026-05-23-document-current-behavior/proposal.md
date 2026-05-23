## Why

The project has accumulated many safety, lifecycle, installer, and OpenCode adapter rules that are currently spread across code, tests, `README.md`, `CONTRACT.md`, and `AGENTS.md`. Capturing the implemented behavior in OpenSpec creates a reviewable baseline for future spec-driven changes without changing runtime behavior.

## What Changes

- Add baseline specifications for the current public CLI contract and internal behavior that affects users.
- Add baseline specifications for worktree lifecycle cleanup, markers, heartbeats, merge safety, installer behavior, OpenCode server plugin behavior, TUI behavior, and manual worktree spawning.
- Do not change implementation code, command flags, stdout/stderr formats, exit codes, hooks, permissions, or installed artifacts.

## Capabilities

### New Capabilities

- `cli-contract`: Public TypeScript CLI commands, argument handling, stdout/stderr behavior, exit codes, fail-open rules, and marker conventions.
- `worktree-isolation`: Session worktree creation, path guarding, dirty-state scanning, merge gating, and manual worktree spawning.
- `lifecycle-cleanup`: Marker TTL cleanup, heartbeat ownership, capture commits, merged worktree cleanup, orphan branch cleanup, residual directory cleanup, and reflection rescue.
- `installer`: Local and remote installation, installed file layout, git hooks, OpenCode configuration merges, idempotency, and stale artifact cleanup.
- `opencode-server-adapter`: OpenCode server plugin bootstrap, system context injection, tool path virtualization, shell environment propagation, main-repo write blocking, and cleanup scheduling.
- `opencode-tui-adapter`: TUI worktree resolution, branch and changed-file observers, sidebar rendering, command registration, builtin files plugin visibility, and refresh behavior.
- `project-governance`: Source boundaries, verification commands, landing expectations, and relationship between OpenSpec, `CONTRACT.md`, tests, and installed mirrors.

### Modified Capabilities

- None. This is the initial OpenSpec baseline for implemented behavior.

## Impact

- Adds documentation-only OpenSpec artifacts under `openspec/`.
- Uses current behavior from `CONTRACT.md`, `AGENTS.md`, `README.md`, `core/`, `adapters/opencode/`, `install.ts`, `remote-install.ts`, and tests as the source material.
- Does not alter runtime code, npm dependencies, OpenCode plugin code, installer output, or git hooks.
