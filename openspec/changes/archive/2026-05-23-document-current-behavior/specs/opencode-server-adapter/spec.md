## ADDED Requirements

### Requirement: Plugin Identity
The OpenCode server plugin SHALL export default plugin id `uplift.worktree` with server function `WorktreePlugin` and SHALL also expose the named `WorktreePlugin` export for tests.

#### Scenario: Module import
- **WHEN** the plugin module is imported
- **THEN** the default export SHALL have id `uplift.worktree` and a server function

### Requirement: Auto Bootstrap Gate
The server plugin SHALL create or enforce session worktrees only when `OPENCODE_WORKTREE_AUTO` equals `1`.

#### Scenario: Auto disabled
- **WHEN** `OPENCODE_WORKTREE_AUTO` is not `1`
- **THEN** bootstrap SHALL be inactive and tool hooks SHALL not alter paths

#### Scenario: Auto enabled
- **WHEN** `OPENCODE_WORKTREE_AUTO=1` and a session-aware event or hook arrives
- **THEN** the plugin SHALL prepare a session bootstrap

### Requirement: Repository Branch Eligibility
The server plugin SHALL activate worktree isolation only when the base directory resolves to a git repository currently on `main` or `master`.

#### Scenario: Non-git directory
- **WHEN** the base directory cannot resolve a git repository
- **THEN** the plugin SHALL leave isolation inactive

#### Scenario: Non-main branch
- **WHEN** the repository branch is neither `main` nor `master`
- **THEN** the plugin SHALL leave isolation inactive

### Requirement: Worktree Core Discovery
The server plugin SHALL discover installed worktree core from `OPENCODE_WORKTREE_ROOT`, `<repo>/.opencode/worktree`, or parent directories near the plugin module.

#### Scenario: Core found
- **WHEN** a candidate contains `core/cmd/worktree-init.ts`
- **THEN** that candidate SHALL be used as worktree root

#### Scenario: Core missing
- **WHEN** no candidate contains the installed core command
- **THEN** bootstrap SHALL be inactive and a warning SHALL be stored for system context

### Requirement: OpenCode Session Id Compaction
The server plugin SHALL convert OpenCode session ids into deterministic compact worktree session ids.

#### Scenario: OpenCode session id
- **WHEN** a session id matches `ses-<id>` or `opencode-ses-<id>`
- **THEN** the worktree session id SHALL be `oc-<first-12-id-chars>`

#### Scenario: Legacy id
- **WHEN** a session id does not match the OpenCode session pattern
- **THEN** the worktree session id SHALL be `oc-<first-24-sanitized-chars>` unless it already starts with `oc-`

### Requirement: Bootstrap Lifecycle
The server plugin SHALL start bootstrap asynchronously, run `worktree-init`, retry once after lifecycle cleanup if init fails, and mark the session ready only after a worktree path is produced.

#### Scenario: Init success
- **WHEN** `worktree-init` returns a worktree path
- **THEN** the plugin SHALL store the ready session config, set process environment variables, launch heartbeat, register process cleanup, and schedule lifecycle cleanup

#### Scenario: Init failure then retry success
- **WHEN** initial `worktree-init` fails but lifecycle prepass and retry succeed
- **THEN** the plugin SHALL recover and mark the worktree ready

#### Scenario: Init retry failure
- **WHEN** retry also fails
- **THEN** the plugin SHALL mark bootstrap failed, store a warning, and supported tool hooks SHALL throw a worktree error while enforcement applies

### Requirement: Bootstrap Cancellation
The server plugin SHALL cancel pending or preparing bootstrap when the corresponding OpenCode session is deleted.

#### Scenario: Session deleted while pending
- **WHEN** `session.deleted` arrives before bootstrap completes
- **THEN** the bootstrap SHALL be marked cancelled and any created auto worktree config SHALL be cleaned up

### Requirement: System Context Injection
The server plugin SHALL add system context messages describing active, checking, pending, or warning worktree state.

#### Scenario: Ready worktree
- **WHEN** chat system transform runs for a ready worktree session
- **THEN** it SHALL append a message instructing file operations to use the worktree root

#### Scenario: Preparing bootstrap
- **WHEN** bootstrap is checking whether a worktree is needed
- **THEN** it SHALL append checking-context guidance

#### Scenario: Pending bootstrap
- **WHEN** bootstrap is creating a worktree
- **THEN** it SHALL append pending-context guidance

### Requirement: Supported Tool Definition Annotation
The server plugin SHALL annotate supported tool descriptions with worktree isolation guidance if not already annotated.

#### Scenario: Supported tool
- **WHEN** OpenCode requests a definition for `read`, `edit`, `write`, `lsp`, `grep`, `glob`, `apply_patch`, `patch`, or `bash`
- **THEN** the plugin SHALL append guidance to use `OPENCODE_WORKTREE_PATH` and avoid the main repository

### Requirement: Shell Environment Injection
The server plugin SHALL inject worktree environment variables into OpenCode shell execution when isolation is active.

#### Scenario: Active shell env
- **WHEN** `shell.env` runs for an active session
- **THEN** it SHALL set `OPENCODE_WORKTREE_ACTIVE`, `OPENCODE_WORKTREE_SESSION`, `OPENCODE_WORKTREE_REPO`, `OPENCODE_WORKTREE_ROOT`, `OPENCODE_WORKTREE_PATH`, `OPENCODE_WORKTREES_DIR`, and `OPENCODE_WORKTREE_BRANCH_PREFIX`

### Requirement: Path Tool Mapping
The server plugin SHALL map supported path-based tool targets into the session worktree unless the user explicitly supplies an absolute main-repository path that must be guarded.

#### Scenario: Relative file path
- **WHEN** a supported path tool receives a relative file path
- **THEN** the plugin SHALL resolve it into the session worktree

#### Scenario: Explicit absolute main path
- **WHEN** a supported path tool receives an explicit absolute path inside the main repository but outside the worktree
- **THEN** the plugin SHALL preserve the explicit target for guard enforcement and block it

#### Scenario: Path already in worktree
- **WHEN** a supported path tool target is already inside the session worktree
- **THEN** the plugin SHALL leave it unchanged

### Requirement: Search Tool Mapping
The server plugin SHALL route supported search tools to the session worktree by default.

#### Scenario: Missing search path
- **WHEN** `grep` or `glob` has no path argument
- **THEN** the plugin SHALL set the path to the session worktree

#### Scenario: Main repository search path
- **WHEN** `grep` or `glob` targets the main repository implicitly
- **THEN** the plugin SHALL map the path to the corresponding worktree path

### Requirement: Patch Tool Mapping
The server plugin SHALL rewrite `apply_patch` or `patch` file headers so patch operations target the session worktree.

#### Scenario: Patch add file
- **WHEN** a patch contains an `Add File` header for a repository-relative path
- **THEN** the plugin SHALL rewrite that target to the equivalent path in the worktree context

#### Scenario: Patch without targets
- **WHEN** a patch has no recognized file target headers
- **THEN** the plugin SHALL still enforce the path guard against a synthetic worktree target

### Requirement: Bash Tool Mapping And Guarding
The server plugin SHALL set `bash` workdir to the worktree by default and SHALL block commands that mention the main repo path without mentioning the worktree path.

#### Scenario: Bash without workdir
- **WHEN** `bash` is called without a workdir
- **THEN** the plugin SHALL set the workdir to the session worktree

#### Scenario: Bash mentions main repo
- **WHEN** a bash command string mentions the main repository path and not the worktree path
- **THEN** the plugin SHALL log a warning and throw a worktree-guard error

### Requirement: Session Marker Refresh
The server plugin SHALL refresh the marker for active ready sessions on idle and status events.

#### Scenario: Idle event
- **WHEN** `session.idle` arrives for a ready active session
- **THEN** the plugin SHALL touch the session marker best-effort

### Requirement: Session Cleanup Scheduling
The server plugin SHALL schedule cleanup for active auto-created sessions on `session.deleted` and process exit.

#### Scenario: Session deleted cleanup
- **WHEN** `session.deleted` arrives for an active session
- **THEN** the plugin SHALL kill heartbeat, run `worktree-cleanup.ts --trust-dead`, delete in-memory session state, and clear warnings

#### Scenario: Process exit cleanup
- **WHEN** the OpenCode process exits with active sessions
- **THEN** the plugin SHALL spawn detached cleanup processes best-effort

### Requirement: Diagnostic Logging Is Non-Blocking
The server plugin SHALL treat OpenCode app logging as best-effort and SHALL NOT let logging failures affect guard decisions or startup.

#### Scenario: App log failure
- **WHEN** OpenCode client logging throws
- **THEN** the plugin SHALL ignore the logging failure and continue the original operation
