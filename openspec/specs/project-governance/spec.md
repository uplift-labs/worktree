# project-governance Specification

## Purpose
TBD - created by archiving change document-current-behavior. Update Purpose after archive.
## Requirements
### Requirement: Public Contract Authority
`CONTRACT.md` SHALL remain the public CLI source of truth for `core/cmd/*` flags, stdout shape, exit codes, marker format, heartbeat format, lifecycle phases, and adapter responsibilities.

#### Scenario: Public CLI change
- **WHEN** a change modifies a public command flag, output shape, exit code, marker format, or lifecycle phase
- **THEN** it SHALL update `CONTRACT.md` and tests in the same change

#### Scenario: Spec conflict
- **WHEN** an OpenSpec requirement conflicts with `CONTRACT.md` for public CLI behavior
- **THEN** `CONTRACT.md` SHALL be treated as authoritative until an explicit contract update is made

### Requirement: OpenSpec Role
OpenSpec SHALL be used as the planning and behavior-specification layer for non-trivial behavior changes, while code, tests, and contract files remain executable and public sources of truth.

#### Scenario: New behavior change
- **WHEN** a non-trivial worktree lifecycle, CLI contract, installer, OpenCode adapter, or governance behavior is changed
- **THEN** the change SHOULD start with or include an OpenSpec change that captures requirements and scenarios

### Requirement: Source Boundaries
Root `core/` and `adapters/opencode/` SHALL be the source of truth for implementation, while `.opencode/worktree/*` and project-local `.opencode/*` plugin files are installed mirrors.

#### Scenario: Core or adapter edit
- **WHEN** source files under `core/` or `adapters/opencode/` are edited
- **THEN** installed mirrors SHALL be synchronized with `node install.ts --target "$PWD"` before completion when feasible

#### Scenario: Installed mirror edit
- **WHEN** a change targets installed `.opencode/worktree/*` or plugin mirror files directly
- **THEN** it SHALL be limited to installer-output testing unless explicitly required

### Requirement: Verification Commands
Repository verification SHALL use `npm run verify`, which runs TypeScript typecheck and the Node test suite.

#### Scenario: Full verification
- **WHEN** repository behavior changes are completed
- **THEN** `npm run verify` SHALL be run unless a blocker is reported

#### Scenario: Typecheck only
- **WHEN** only TypeScript type validation is needed
- **THEN** `npm run typecheck` SHALL run `tsc --noEmit`

#### Scenario: Test only
- **WHEN** only tests are needed
- **THEN** `npm test` SHALL run Node's built-in test runner over `tests/*.test.ts`

### Requirement: Test Strategy
Tests SHALL use real temporary git repositories and cross-platform Node APIs rather than shell-specific assumptions.

#### Scenario: Git behavior test
- **WHEN** testing worktree or git behavior
- **THEN** tests SHALL create real temporary repositories with `fs.mkdtempSync` and `git init`

#### Scenario: Cross-platform test
- **WHEN** adding or changing tests
- **THEN** tests SHALL avoid shell-only syntax and platform-specific assumptions unless explicitly guarded

### Requirement: Worktree Discipline In OpenCode Sessions
During OpenCode sessions, `OPENCODE_WORKTREE_PATH` SHALL be treated as the active project root for file reads and edits when worktree isolation is active.

#### Scenario: UI shows original repo
- **WHEN** OpenCode still displays the original repository or branch
- **THEN** users and agents SHALL trust `OPENCODE_WORKTREE_PATH`, tool working directories, and `git status` run from the tool for active worktree state

### Requirement: Landing Completed Main Changes
When asked to land, ship, upload, or fix changes in `main`, the workflow SHALL complete verification, commit, merge or fast-forward to `main`, push, and dogfood installed/current state when feasible.

#### Scenario: Worktree-only blocker
- **WHEN** completed work cannot be landed from an isolated worktree
- **THEN** the blocker and safest next command SHALL be reported rather than leaving work silently stranded

### Requirement: OpenCode Adapter Verification
OpenCode adapter verification SHALL not use `OPENCODE_PURE=1` because pure mode skips project plugins.

#### Scenario: OpenCode upgrade
- **WHEN** OpenCode is upgraded
- **THEN** compatibility checks SHALL cover server hooks, shell env, tool definitions, system transform, TUI events, and local project plugin loading

### Requirement: Optional OS Sandbox Scope
The OpenCode OS sandbox option SHALL be treated as adapter configuration only and SHALL NOT change `core/cmd/*` behavior or exit codes.

#### Scenario: Sandbox option enabled
- **WHEN** `--with-opencode-os-sandbox` is installed
- **THEN** OpenCode bash tool calls MAY be wrapped by the external sandbox plugin on supported platforms, but core command contracts SHALL remain unchanged

### Requirement: No Data Loss Cleanup Policy
Cleanup behavior SHALL preserve dirty or unmerged worktrees and SHALL remove only merged clean worktrees or stale empty/generated state.

#### Scenario: Dirty unmerged state
- **WHEN** cleanup encounters dirty or unmerged worktree state
- **THEN** it SHALL preserve that worktree for manual review

### Requirement: Deliberate Merge Policy
Session cleanup SHALL never merge work into main; merging SHALL remain a deliberate user action protected by the merge gate.

#### Scenario: Cleanup after session deletion
- **WHEN** session cleanup runs after OpenCode session deletion or process exit
- **THEN** it MAY capture-commit pending work but SHALL NOT merge the worktree branch into main

