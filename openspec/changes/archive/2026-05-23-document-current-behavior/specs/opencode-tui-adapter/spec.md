## ADDED Requirements

### Requirement: TUI Plugin Identity
The TUI plugin SHALL export a deterministic id based on `worktree.branch` and the normalized module path hash.

#### Scenario: Module id generation
- **WHEN** the TUI plugin is loaded from a module URL
- **THEN** its id SHALL start with `worktree.branch` and include a stable hash for that module path

### Requirement: Duplicate TUI Plugin Suppression
The TUI plugin SHALL avoid running a main-repository plugin copy when OpenCode is already running inside a worktree that contains its own plugin copy.

#### Scenario: Worktree-local plugin exists
- **WHEN** the current directory is inside the worktree and a matching plugin file exists inside the worktree `.opencode/tui-plugins`
- **THEN** the main-repository TUI plugin copy SHALL not run

#### Scenario: No worktree-local plugin
- **WHEN** no worktree-local plugin copy exists
- **THEN** the TUI plugin MAY run from the current module

### Requirement: Worktree Resolution
The TUI core SHALL resolve the active worktree from `OPENCODE_WORKTREE_PATH`, session markers, `git worktree list`, known worktree layout, or current worktree branch inference.

#### Scenario: Direct environment path
- **WHEN** `OPENCODE_WORKTREE_ACTIVE=1` and `OPENCODE_WORKTREE_PATH` points to an existing directory
- **THEN** TUI resolution SHALL return that path

#### Scenario: Marker branch
- **WHEN** a session marker exists and contains a branch name
- **THEN** TUI resolution SHALL find that branch in `git worktree list` or the known worktrees layout

#### Scenario: Current worktree branch inference
- **WHEN** no marker branch is available but the current branch starts with the configured worktree prefix and the listed worktree basename equals the branch
- **THEN** TUI resolution SHALL infer that worktree

### Requirement: Session Id Candidates
The TUI core SHALL check compact, `opencode-` prefixed, and raw session id candidates when resolving markers.

#### Scenario: Session id variants
- **WHEN** a session id is supplied
- **THEN** marker resolution SHALL consider compact `oc-*`, `opencode-*`, and raw sanitized variants without duplicates

### Requirement: Renderable Worktree Detection
The TUI files sidebar SHALL render only when a worktree can be resolved and the current directory is not already inside that worktree.

#### Scenario: Main repo view
- **WHEN** OpenCode is displaying the main repository and a session worktree exists
- **THEN** the files sidebar MAY render changed files from the worktree

#### Scenario: Worktree view
- **WHEN** OpenCode is already displaying a directory inside the worktree
- **THEN** the worktree files sidebar SHALL not render a duplicate view

### Requirement: Changed Files Calculation
The TUI core SHALL calculate changed files from committed branch diff, staged diff, unstaged diff, and untracked files.

#### Scenario: Base ref diff
- **WHEN** a base ref can be resolved
- **THEN** changed-file calculation SHALL include `HEAD` changes since that base ref

#### Scenario: Staged and unstaged changes
- **WHEN** the worktree has staged or unstaged changes
- **THEN** changed-file calculation SHALL include their additions and deletions

#### Scenario: Untracked files
- **WHEN** the worktree has untracked non-ignored files
- **THEN** changed-file calculation SHALL include those files with zero additions and deletions

### Requirement: Base Ref Resolution
The TUI core SHALL resolve a changed-file base ref from explicit input or environment, then a merge base with main/master/origin refs, then marker initial head.

#### Scenario: Explicit base ref
- **WHEN** `OPENCODE_WORKTREE_BASE_REF` or input base ref names an existing commit
- **THEN** it SHALL be used as the diff base

#### Scenario: Main merge base
- **WHEN** no explicit base ref exists and a merge base exists with `main`, `master`, `origin/main`, or `origin/master`
- **THEN** that merge base SHALL be used

#### Scenario: Marker initial head fallback
- **WHEN** no merge base is available but the marker initial head exists as a commit
- **THEN** the marker initial head SHALL be used as the diff base

### Requirement: Branch Observer
The TUI branch observer SHALL watch the worktree git `HEAD` path when possible and poll as a fallback.

#### Scenario: Head watch available
- **WHEN** branch watching is enabled and the git `HEAD` path exists
- **THEN** the observer SHALL watch the `HEAD` directory and schedule branch refreshes on head events

#### Scenario: Watch unavailable
- **WHEN** watching is disabled or fails
- **THEN** the observer SHALL refresh through polling

#### Scenario: Branch change
- **WHEN** the observed branch changes
- **THEN** the observer SHALL call its change callback with branch, worktree, and reason

### Requirement: Changed Files Observer
The TUI changed-files observer SHALL poll or schedule refreshes and call its change callback only when the files signature changes.

#### Scenario: Files changed
- **WHEN** the resolved changed-files list differs from the previous signature
- **THEN** the observer SHALL update state and call its change callback

#### Scenario: Poll disabled
- **WHEN** `AISB_OPENCODE_FILES_REFRESH_MS` is zero
- **THEN** the observer SHALL disable file polling

### Requirement: TUI Event Refreshes
The TUI plugin SHALL refresh branch and file state in response to OpenCode event bus events for session, file, vcs, tool, and shell activity.

#### Scenario: Branch refresh event
- **WHEN** a branch refresh event arrives for the current session
- **THEN** the branch observer SHALL refresh

#### Scenario: File refresh event
- **WHEN** a file refresh event arrives for the current session
- **THEN** the changed-files observer SHALL schedule a refresh

#### Scenario: Other session event
- **WHEN** an event contains a different session id
- **THEN** the observer SHALL ignore it

### Requirement: Branch Badge
The TUI plugin SHALL register branch badge slots only when `AISB_OPENCODE_BRANCH_BADGE=1`.

#### Scenario: Badge enabled
- **WHEN** branch badge is enabled
- **THEN** the plugin SHALL register prompt-right slots that render `<label>:<branch>` when a branch is known

#### Scenario: Custom label
- **WHEN** `AISB_OPENCODE_BRANCH_LABEL` is set
- **THEN** the badge SHALL use that label instead of `branch`

### Requirement: Worktree Files Sidebar
The TUI plugin SHALL register a right-sidebar section showing worktree modified files when files exist.

#### Scenario: No changed files
- **WHEN** the changed-files list is empty
- **THEN** the sidebar content SHALL render nothing for the files list

#### Scenario: More than two files
- **WHEN** more than two changed files are present
- **THEN** the files section SHALL be collapsible by mouse click

#### Scenario: Custom title
- **WHEN** `AISB_OPENCODE_FILES_LABEL` is set
- **THEN** the files sidebar SHALL use that value as the section title

### Requirement: Builtin Files Plugin Visibility
The TUI plugin SHALL support hiding the built-in files sidebar while the worktree files sidebar is active when `AISB_OPENCODE_HIDE_BUILTIN_FILES=1`.

#### Scenario: Hide enabled and worktree active
- **WHEN** hide is enabled and a worktree files view becomes active
- **THEN** the TUI plugin SHALL deactivate `internal:sidebar-files` best-effort and preserve prior enabled-state data

#### Scenario: Worktree inactive
- **WHEN** the worktree files view is released
- **THEN** the TUI plugin SHALL restore the built-in files plugin visibility according to previous state

### Requirement: TUI Slash Command
The TUI plugin SHALL register a `/worktree` command when the TUI API supports command registration.

#### Scenario: Worktree command selected
- **WHEN** the user selects `/worktree`
- **THEN** the plugin SHALL run `worktree-spawn.ts` through the installed core and show a toast summarizing the command result

#### Scenario: Supported command args
- **WHEN** `/worktree` receives arguments
- **THEN** the TUI command SHALL forward only supported spawn options such as `-n`, `--count`, `--print`, and `--no-dirty`

### Requirement: TUI Debug Diagnostics
The TUI core SHALL emit debug diagnostics and warning toasts only when the relevant debug environment variable is enabled.

#### Scenario: Branch debug disabled
- **WHEN** branch refresh fails and `AISB_OPENCODE_BRANCH_DEBUG` is not `1`
- **THEN** the plugin SHALL not show a branch warning toast

#### Scenario: Files debug enabled
- **WHEN** files refresh fails and `AISB_OPENCODE_FILES_DEBUG=1`
- **THEN** the plugin SHALL show a warning toast with the failure phase
