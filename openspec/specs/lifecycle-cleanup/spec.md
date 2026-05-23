# lifecycle-cleanup Specification

## Purpose
TBD - created by archiving change document-current-behavior. Update Purpose after archive.
## Requirements
### Requirement: Lifecycle Phase Order
`worktree-lifecycle` SHALL run cleanup phases in this order: reflection rescue, git worktree metadata prune, TTL marker reclaim with heartbeat checks, proactive marker release, merged worktree cleanup, orphan branch sweep, and residual directory sweep.

#### Scenario: Ordered cleanup
- **WHEN** lifecycle runs
- **THEN** each phase SHALL execute in the documented order so later phases observe state changes made by earlier phases

### Requirement: Reflection Rescue
Lifecycle SHALL invoke reflection rescue before destructive worktree cleanup.

#### Scenario: Rescue before removal
- **WHEN** a preserved or removable worktree contains Markdown reflection files
- **THEN** lifecycle SHALL attempt to rescue those files before worktree removal phases run

### Requirement: Reflection File Selection
Reflection rescue SHALL copy only `*.md` files from the configured sidecar directory and SHALL default that directory to `.reinforce/reflections`.

#### Scenario: Markdown file present
- **WHEN** a worktree contains `.reinforce/reflections/note.md` and the main repository does not contain that file
- **THEN** rescue SHALL copy it into the main repository and remove the worktree copy

#### Scenario: Non-Markdown file present
- **WHEN** a sidecar directory contains a non-Markdown file
- **THEN** rescue SHALL leave it untouched

### Requirement: Reflection Deduplication
Reflection rescue SHALL prefer existing main-repository copies over duplicate worktree copies.

#### Scenario: Existing main copy
- **WHEN** a Markdown reflection file already exists in the main repository
- **THEN** rescue SHALL delete the duplicate worktree copy and report it as deduped

### Requirement: Heartbeat Sidecar Format
Heartbeat sidecars SHALL be stored at `<marker-path>.hb` and contain `<heartbeat_pid> <parent_winpid|0> <monitored_pid|0>`.

#### Scenario: Heartbeat start
- **WHEN** heartbeat starts for a marker
- **THEN** it SHALL write its own process id, parent Windows pid when known, and monitored pid when known to the sidecar

### Requirement: Heartbeat Marker Touch
Heartbeat SHALL touch the marker mtime while the owning process is considered alive.

#### Scenario: Live owner
- **WHEN** the monitored process or Windows parent pid is alive
- **THEN** heartbeat SHALL periodically update the marker mtime

#### Scenario: Marker removed
- **WHEN** the marker file disappears
- **THEN** heartbeat SHALL exit successfully

### Requirement: Heartbeat Parent Death Cleanup
Heartbeat SHALL schedule session cleanup when the owning process dies and repository plus worktree root are known.

#### Scenario: Parent death
- **WHEN** heartbeat detects that the monitored owner died
- **THEN** it SHALL spawn `worktree-cleanup.ts` for the marker session in a detached process

#### Scenario: Live owner sanity on Windows
- **WHEN** Windows heartbeat parent death is detected but a configured owner process name is still live
- **THEN** heartbeat SHALL skip cleanup, remove the sidecar, and log the skip

### Requirement: Marker TTL Reclaim
Lifecycle SHALL remove stale markers and heartbeat sidecars when marker mtimes exceed their effective TTL and no live heartbeat owner is present.

#### Scenario: Stale marker
- **WHEN** a marker is older than the effective TTL and no live owner exists
- **THEN** lifecycle SHALL remove the marker and sidecar

#### Scenario: Fresh marker grace
- **WHEN** a marker is younger than 30 seconds
- **THEN** lifecycle SHALL not reclaim it regardless of the configured TTL

### Requirement: Fresh Session Protection
Lifecycle SHALL protect sessions that have no commits beyond their initial head with an extended fresh-session TTL of 300 seconds.

#### Scenario: No new commits
- **WHEN** the worktree `HEAD` equals the marker initial head
- **THEN** lifecycle SHALL use the fresh-session TTL instead of the configured TTL

#### Scenario: Legacy marker without initial head
- **WHEN** a marker lacks an initial head
- **THEN** lifecycle SHALL warn about a malformed or legacy marker and use the fresh-session TTL

### Requirement: Orphan Marker Prune
Lifecycle SHALL remove marker files whose recorded worktree branch no longer has an existing worktree directory.

#### Scenario: Missing worktree directory
- **WHEN** a marker points to a branch path that no longer exists under the configured worktrees directory
- **THEN** lifecycle SHALL kill any heartbeat pid, remove the marker, and remove the sidecar

### Requirement: Proactive Marker Release
Lifecycle SHALL release markers for merged clean worktrees when no live owner protects the marker and the worktree has real session progress beyond the initial head.

#### Scenario: Merged clean worktree
- **WHEN** the worktree branch is an ancestor of the main branch, the worktree is clean ignoring deletions, no operation is in progress, and `HEAD` is symbolic
- **THEN** lifecycle SHALL remove the marker and sidecar

#### Scenario: Fresh unchanged worktree
- **WHEN** the worktree `HEAD` equals the marker initial head and the heartbeat is not definitely dead
- **THEN** lifecycle SHALL keep the marker

### Requirement: Merged Worktree Removal
Lifecycle SHALL remove unprotected linked worktrees whose branches are merged into the main branch and whose worktrees are clean ignoring deletions.

#### Scenario: Removable merged worktree
- **WHEN** an unprotected linked worktree branch is merged and clean
- **THEN** lifecycle SHALL remove the worktree and delete the branch

#### Scenario: Unmerged worktree
- **WHEN** a linked worktree branch is not an ancestor of the main branch
- **THEN** lifecycle SHALL preserve the worktree and report that it needs manual review

#### Scenario: Dirty merged worktree
- **WHEN** a linked worktree branch is merged but has unsaved work
- **THEN** lifecycle SHALL preserve the worktree and report the dirty-state summary

### Requirement: Orphan Branch Sweep
Lifecycle SHALL delete merged branches matching the configured branch glob when they are not attached to any worktree and are not explicitly preserved.

#### Scenario: Merged unattached branch
- **WHEN** a branch matches the configured glob, is merged into main, and is not listed in `git worktree list`
- **THEN** lifecycle SHALL delete the branch and report it

#### Scenario: Attached branch
- **WHEN** a matching branch is still attached to a worktree
- **THEN** lifecycle SHALL not delete it during orphan branch sweep

### Requirement: Residual Directory Sweep
Lifecycle SHALL clean empty residual directories under the configured worktrees parent that do not contain `.git`.

#### Scenario: Empty residual directory
- **WHEN** a directory under the worktrees parent has no `.git` and no visible files
- **THEN** lifecycle SHALL remove it and report the residual removal

#### Scenario: Non-empty residual directory
- **WHEN** a directory under the worktrees parent has visible files but no `.git`
- **THEN** lifecycle SHALL preserve it and report the visible file count

### Requirement: Capture Commit During Cleanup
Session cleanup SHALL stage all pending work and create a capture commit with message `chore(worktree-cleanup): capture pending work` when safe to commit.

#### Scenario: Pending work
- **WHEN** cleanup finds staged or unstaged changes and no merge, rebase, or detached `HEAD` state is present
- **THEN** cleanup SHALL stage all changes and attempt a capture commit

#### Scenario: In-progress operation
- **WHEN** cleanup detects merge or rebase state
- **THEN** cleanup SHALL skip capture commit and leave the worktree as-is

#### Scenario: Detached HEAD
- **WHEN** cleanup detects detached `HEAD`
- **THEN** cleanup SHALL skip capture commit and leave the worktree as-is

### Requirement: Cleanup Self Release
Session cleanup SHALL self-release the marker only when the worktree branch is merged into the root branch, the worktree is clean ignoring deletions, the worktree can be committed, and fresh-session guards allow release.

#### Scenario: Trust-dead cleanup
- **WHEN** cleanup runs with `--trust-dead`
- **THEN** it MAY release a merged clean marker even if the worktree has no progress beyond initial head

#### Scenario: Non-trust-dead fresh session
- **WHEN** cleanup runs without `--trust-dead` and the worktree has no progress beyond initial head
- **THEN** cleanup SHALL keep the marker fresh rather than release it

### Requirement: Cleanup Lifecycle Invocation
Session cleanup SHALL invoke lifecycle after capture commit and self-release handling.

#### Scenario: Marker survives cleanup
- **WHEN** the marker still exists after cleanup phase handling
- **THEN** cleanup SHALL touch the marker before invoking lifecycle

