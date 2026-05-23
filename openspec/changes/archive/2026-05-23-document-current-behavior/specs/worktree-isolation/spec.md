## ADDED Requirements

### Requirement: Session Worktree Isolation
The system SHALL isolate supported OpenCode session work inside a linked git worktree created under `.opencode/worktree/worktrees/<branch-name>` by default.

#### Scenario: Default worktree location
- **WHEN** a session worktree is created without an override
- **THEN** it SHALL be placed under `<repo-root>/.opencode/worktree/worktrees/<branch-name>`

#### Scenario: Branch naming
- **WHEN** a session id is converted to a worktree branch
- **THEN** the branch SHALL use the configured prefix followed by a sanitized session id

### Requirement: Main Branch Protection
The system SHALL protect the main repository by routing supported file operations into the session worktree and by blocking explicit main-repo write targets when a session worktree is active.

#### Scenario: Main repo target during active session
- **WHEN** an active session attempts to write inside the main repository but outside its worktree
- **THEN** the operation SHALL be blocked with a worktree-guard message

#### Scenario: Worktree target during active session
- **WHEN** an active session targets a path inside its worktree
- **THEN** the operation SHALL be allowed

### Requirement: Dirty-State Scanning
The system SHALL scan worktree cleanliness using `git status --porcelain` after refreshing the index.

#### Scenario: Tracked and untracked changes
- **WHEN** a worktree has modified tracked files and untracked files
- **THEN** the scan SHALL report `clean=false` with separate tracked and untracked counts

#### Scenario: Ignored files
- **WHEN** a file is ignored by git
- **THEN** the scan SHALL NOT count it as untracked work

### Requirement: Optional Deletion Ignoring
Cleanup paths SHALL support ignoring unstaged deletions when deciding whether a merged worktree can be removed or released.

#### Scenario: Ignore deletion option
- **WHEN** a cleanup scan runs with `ignoreDeletions`
- **THEN** status lines beginning with an unstaged deletion marker SHALL be excluded from the dirty-state count

### Requirement: Merge Gate Cleanliness
The merge gate SHALL block a merge if the source worktree being merged has tracked modifications or untracked files.

#### Scenario: Untracked file before merge
- **WHEN** the source worktree contains an untracked file
- **THEN** the merge gate SHALL block the merge and instruct the user to commit or stash before merge

#### Scenario: Committed worktree before merge
- **WHEN** all work in the source worktree is committed
- **THEN** the merge gate SHALL allow the merge

### Requirement: Installed Pre-Merge Source Worktree Resolution
The installed `pre-merge-commit` hook SHALL identify the linked worktree being merged by matching `GITHEAD_*` commit shas against `git worktree list --porcelain` output.

#### Scenario: Matching linked worktree
- **WHEN** a merge head sha matches the `HEAD` of a non-root linked worktree
- **THEN** the hook SHALL run `worktree-merge-gate.ts --worktree <matched-worktree>`

#### Scenario: No matching linked worktree
- **WHEN** the hook cannot map the merge to a linked worktree
- **THEN** the hook SHALL fail open with exit code `0`

#### Scenario: Hook environment cleanup
- **WHEN** the hook runs the merge gate
- **THEN** it SHALL remove `GIT_INDEX_FILE`, `GIT_DIR`, `GIT_WORK_TREE`, and `GIT_PREFIX` from the environment before inspecting worktrees

### Requirement: Manual Worktree Spawning
The system SHALL support manually spawning up to 50 worktrees from the current repository `HEAD`.

#### Scenario: Count clamping
- **WHEN** manual spawn receives a count greater than 50
- **THEN** the library SHALL create at most 50 worktrees

#### Scenario: Unique branch allocation
- **WHEN** manual spawn creates a worktree
- **THEN** it SHALL allocate a unique branch using the configured prefix, timestamp, process id, and attempt number

### Requirement: Dirty State Copy For Manual Spawn
Manual worktree spawning SHALL copy staged, unstaged, and untracked non-ignored state from the source repository unless disabled.

#### Scenario: Copy staged changes
- **WHEN** the source repository has staged changes and dirty copying is enabled
- **THEN** the spawned worktree SHALL contain those changes staged in its index

#### Scenario: Copy unstaged changes
- **WHEN** the source repository has unstaged tracked changes and dirty copying is enabled
- **THEN** the spawned worktree SHALL contain those changes unstaged

#### Scenario: Copy untracked files
- **WHEN** the source repository has untracked non-ignored files and dirty copying is enabled
- **THEN** the spawned worktree SHALL contain those files as untracked files

#### Scenario: Disable dirty copy
- **WHEN** manual spawn runs with `--no-dirty`
- **THEN** staged, unstaged, and untracked source state SHALL NOT be copied into the spawned worktree

### Requirement: Manual Launch Commands
Manual worktree spawning SHALL produce OpenCode launch commands for every spawned worktree and SHALL launch Windows Terminal tabs only when available and not in print-only mode.

#### Scenario: Windows Terminal unavailable
- **WHEN** `wt.exe` is not available
- **THEN** the command SHALL print manual launch commands

#### Scenario: Windows Terminal launch
- **WHEN** `wt.exe` is available on Windows and print-only mode is disabled
- **THEN** the system SHALL attempt to launch a new tab titled with the worktree branch and starting in the worktree directory

### Requirement: Spawn Rollback On Failure
Manual worktree spawning SHALL remove all worktrees and branches created during the current spawn attempt if creation or dirty-state copy fails.

#### Scenario: Dirty copy failure
- **WHEN** copying dirty state into a spawned worktree fails
- **THEN** the system SHALL force-remove created worktrees and delete their branches before surfacing the error
