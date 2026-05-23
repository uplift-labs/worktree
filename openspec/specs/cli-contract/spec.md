# cli-contract Specification

## Purpose
TBD - created by archiving change document-current-behavior. Update Purpose after archive.
## Requirements
### Requirement: Public CLI Entry Points
The system SHALL treat every TypeScript file under `core/cmd/` as a stable public command entry point invoked as `node core/cmd/<command>.ts ...` on Node.js 24 or newer.

#### Scenario: Command invocation
- **WHEN** a user invokes a public command with Node.js 24 or newer
- **THEN** the command SHALL execute directly from its TypeScript source file

#### Scenario: Internal library boundary
- **WHEN** code outside `core/` needs worktree behavior
- **THEN** it SHALL call public commands or adapter APIs rather than import `core/lib/*` as a public contract

### Requirement: CLI Inputs And Outputs
The public CLI commands SHALL accept flags and environment variables as input, SHALL NOT require JSON on stdin, and SHALL print human-readable output rather than JSON unless explicitly specified by the command contract.

#### Scenario: Human-readable output
- **WHEN** a command reports success, denial, diagnostics, or usage failures
- **THEN** the output SHALL be human-readable text

### Requirement: CLI Exit Codes
The public CLI commands SHALL use exit code `0` for success or allow, `1` for denial or hard failure with a reason, and `2` for bad usage.

#### Scenario: Bad usage
- **WHEN** a command is missing required flags or receives an unknown flag
- **THEN** the command SHALL exit with code `2` and print usage information to stderr

#### Scenario: Denial
- **WHEN** a command intentionally blocks an operation
- **THEN** the command SHALL exit with code `1` and print a human-readable reason

### Requirement: Fail-Open Git Context
Safety-net commands SHALL fail open with exit code `0` when git context cannot be resolved, except commands whose contract requires a hard failure for an invalid repository or invalid target.

#### Scenario: Guard without git context
- **WHEN** `worktree-guard` cannot resolve a git root or marker path
- **THEN** it SHALL allow the operation with exit code `0`

#### Scenario: Lifecycle without git context
- **WHEN** `worktree-lifecycle` cannot resolve the repository git root or common directory
- **THEN** it SHALL exit `0` without cleanup actions

### Requirement: Marker Storage And Sanitization
Session markers SHALL be stored under `<git-common-dir>/worktree-markers/<safe-session-id>`, where the safe session id replaces every character outside `[A-Za-z0-9-]` with `-`.

#### Scenario: Unsafe session id
- **WHEN** a session id contains `/`, `:`, spaces, or other non-safe characters
- **THEN** marker lookup and writes SHALL use the deterministic sanitized id

#### Scenario: Marker fields
- **WHEN** a marker is written for a created worktree
- **THEN** it SHALL contain `branch epoch initial_head` fields when the initial head is known

### Requirement: Legacy Marker Lookup
Marker lookup SHALL preserve deterministic access to legacy unsanitized marker files only when the original session id is not a path-like value and the legacy path already exists.

#### Scenario: Existing legacy marker
- **WHEN** a non-path-like legacy marker exists for the raw session id
- **THEN** marker lookup MAY return that legacy marker instead of the sanitized path

#### Scenario: Path traversal prevention
- **WHEN** the session id is path-like or empty
- **THEN** marker lookup SHALL NOT allow path traversal outside the marker directory

### Requirement: Worktree Init CLI
`worktree-init` SHALL create or reuse a session worktree from a main branch repository using `--repo`, `--session`, optional `--base`, optional `--worktrees-dir`, and optional `--branch-prefix`.

#### Scenario: Successful creation
- **WHEN** `worktree-init` runs in a main or master repository with a new session
- **THEN** it SHALL create branch `<branch-prefix>-<safe-session-id>` under the configured worktrees directory, write a marker, print the absolute worktree path, and exit `0`

#### Scenario: Fresh marker reuse
- **WHEN** a fresh marker points to an existing worktree
- **THEN** `worktree-init` SHALL print the existing worktree path and exit `0` without creating another worktree

#### Scenario: Non-main repository branch
- **WHEN** the target repository is not on `main` or `master`
- **THEN** `worktree-init` SHALL exit `0` without creating a worktree

#### Scenario: Nested linked worktree
- **WHEN** the target repository is already a linked worktree
- **THEN** `worktree-init` SHALL refuse to nest, print a reason, and exit `1`

### Requirement: Worktree Guard CLI
`worktree-guard` SHALL decide whether an edit target is allowed based on the active session marker, repository root, and session worktree path.

#### Scenario: Edit inside session worktree
- **WHEN** the target path is the session worktree or inside it
- **THEN** `worktree-guard` SHALL allow the edit with exit code `0`

#### Scenario: Edit inside main repository
- **WHEN** a session marker exists and the target path is inside the main repository but outside the session worktree
- **THEN** `worktree-guard` SHALL deny the edit with exit code `1` and a message instructing the user to edit the worktree and merge via git

#### Scenario: Edit outside repository
- **WHEN** the target path is outside the repository
- **THEN** `worktree-guard` SHALL allow the edit with exit code `0`

### Requirement: Worktree Lifecycle CLI
`worktree-lifecycle` SHALL perform periodic cleanup for a repository using `--repo`, optional `--ttl`, optional `--branch-prefix`, and optional `--worktrees-dir`.

#### Scenario: Cleanup report
- **WHEN** lifecycle removes, preserves, rescues, releases, or sweeps any state
- **THEN** it SHALL print a multi-line report starting with `worktree-lifecycle: cleaned=<count>` unless quiet mode is used

#### Scenario: No cleanup actions
- **WHEN** lifecycle has no printable action lines
- **THEN** it SHALL exit `0` silently

### Requirement: Worktree Cleanup CLI
`worktree-cleanup` SHALL perform session cleanup for a marker-backed worktree using `--repo`, `--session`, optional `--trust-dead`, optional `--worktrees-dir`, and optional `--branch-prefix`.

#### Scenario: Missing marker
- **WHEN** no marker exists for the session
- **THEN** `worktree-cleanup` SHALL exit `0` without action

#### Scenario: Diagnostics stream
- **WHEN** cleanup skips capture commits or capture commit fails
- **THEN** diagnostic output SHALL go to stderr and cleanup SHALL remain fail-open

### Requirement: Reflection Rescue CLI
`reflection-rescue` SHALL best-effort rescue Markdown sidecar files from configured worktree reflection directories into the main repository.

#### Scenario: Missing repository or worktrees
- **WHEN** the repository or worktrees directory is missing
- **THEN** `reflection-rescue` SHALL exit `0` without hard failure

### Requirement: Merge Gate CLI
`worktree-merge-gate` SHALL validate that a target worktree directory exists and has no tracked modifications or untracked files before merge.

#### Scenario: Dirty worktree
- **WHEN** the target worktree has tracked modifications or untracked files
- **THEN** `worktree-merge-gate` SHALL print `worktree-merge-gate: BLOCKED`, include a summary, and exit `1`

#### Scenario: Clean worktree
- **WHEN** the target worktree is clean
- **THEN** `worktree-merge-gate` SHALL exit `0`

### Requirement: Worktree Spawn CLI
`worktree-spawn` SHALL create one or more ad-hoc worktrees from the current repository head and optionally launch OpenCode sessions in Windows Terminal.

#### Scenario: Print-only spawn
- **WHEN** `worktree-spawn` runs with `--print`
- **THEN** it SHALL create worktrees, print their paths, and print manual launch commands without launching Windows Terminal

#### Scenario: Invalid count
- **WHEN** `worktree-spawn` receives a missing, non-finite, or less-than-one count
- **THEN** it SHALL fail usage validation with exit code `2`

