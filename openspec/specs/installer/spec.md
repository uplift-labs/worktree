# installer Specification

## Purpose
TBD - created by archiving change document-current-behavior. Update Purpose after archive.
## Requirements
### Requirement: Local Install Target Validation
`install.ts` SHALL install only into a target that git recognizes as being inside a work tree.

#### Scenario: Non-git target
- **WHEN** the target directory is not inside a git work tree
- **THEN** install SHALL print `not a git repo: <target>` to stderr and exit `1`

#### Scenario: Default target and prefix
- **WHEN** install runs without `--target` or `--prefix`
- **THEN** it SHALL install into the current directory using `.opencode` as the prefix

### Requirement: Installed Core Layout
Install SHALL copy root `core/lib/*.ts` and `core/cmd/*.ts` into `<target>/<prefix>/worktree/core/lib` and `<target>/<prefix>/worktree/core/cmd`.

#### Scenario: TypeScript core copy
- **WHEN** install succeeds
- **THEN** TypeScript command and library files SHALL exist under the installed worktree core directory

#### Scenario: Stale core artifact cleanup
- **WHEN** installed core destination contains stale `.js` or `.sh` files for copied sources
- **THEN** install SHALL remove those stale files while syncing TypeScript files

### Requirement: Installed OpenCode Adapter Layout
Install SHALL copy OpenCode server plugin and TUI adapter TypeScript sources into `<target>/<prefix>/worktree/adapters/opencode`.

#### Scenario: Adapter copy
- **WHEN** install succeeds
- **THEN** `plugins/worktree.ts` and TUI TypeScript files SHALL exist in the installed adapter directory

#### Scenario: Removed legacy adapter directories
- **WHEN** install runs
- **THEN** it SHALL remove stale `adapter`, non-OpenCode adapters, and stale OpenCode `bin` or `lib` directories under the install root

### Requirement: Project OpenCode Plugin Files
Install SHALL write project-local OpenCode server and TUI plugin files under `.opencode/plugins` and `.opencode/tui-plugins`.

#### Scenario: Server plugin write
- **WHEN** install succeeds
- **THEN** `.opencode/plugins/worktree.ts` SHALL be copied from the source adapter

#### Scenario: TUI plugin write
- **WHEN** install succeeds
- **THEN** matching TypeScript and TSX TUI files SHALL be copied into `.opencode/tui-plugins`

#### Scenario: Stale OpenCode plugin cleanup
- **WHEN** stale worktree plugin files such as `.js` or sandbox-era files exist
- **THEN** install SHALL remove them before writing current files

### Requirement: TUI Plugin Registration
Install SHALL ensure `.opencode/tui.json` registers `./tui-plugins/worktree-branch.tsx` without duplicating existing plugin entries.

#### Scenario: Missing TUI config
- **WHEN** `.opencode/tui.json` does not exist
- **THEN** install SHALL create a JSON object with the OpenCode TUI schema and plugin list

#### Scenario: Existing plugin list
- **WHEN** `.opencode/tui.json` already contains a plugin array
- **THEN** install SHALL append the worktree TUI plugin only if it is not already present

### Requirement: Gitignore Worktrees Entry
Install SHALL ensure the generated worktrees directory is ignored by the target repository.

#### Scenario: Missing ignore entry
- **WHEN** `.gitignore` does not contain `/<prefix>/worktree/worktrees/`
- **THEN** install SHALL append a generated comment and the ignore pattern

#### Scenario: Existing ignore entry
- **WHEN** `.gitignore` already contains the exact ignore pattern
- **THEN** install SHALL leave it unchanged

### Requirement: Pre-Merge Hook Installation
Install SHALL write an executable `pre-merge-commit` hook into the target git common hooks directory.

#### Scenario: Hook gate invocation
- **WHEN** the pre-merge hook maps a merge head to a non-root linked worktree
- **THEN** it SHALL run the installed `worktree-merge-gate.ts` against that worktree

#### Scenario: Hook fail-open cases
- **WHEN** repository resolution, merge-head lookup, worktree listing, or source worktree matching fails
- **THEN** the pre-merge hook SHALL exit `0`

#### Scenario: Gate failure
- **WHEN** the merge gate returns non-zero
- **THEN** the hook SHALL write the gate output to stderr and exit `1`

### Requirement: Post-Merge Hook Installation
Install SHALL write an executable `post-merge` hook that re-runs `install.ts` in the background after merges when the repository contains `install.ts`.

#### Scenario: Installer missing
- **WHEN** the post-merge hook cannot find `install.ts` at the repository root
- **THEN** it SHALL exit `0`

#### Scenario: Preserve optional OpenCode options
- **WHEN** `opencode.json` indicates conservative permissions or `opencode-sandbox` are active
- **THEN** the post-merge hook SHALL forward the corresponding install flags

### Requirement: Conservative Permission Merge
Install with `--with-opencode-permissions` SHALL merge conservative OpenCode permission defaults without overwriting existing user rules.

#### Scenario: Missing permission object
- **WHEN** `opencode.json` lacks `permission`
- **THEN** install SHALL create a permission object

#### Scenario: Existing bash rule
- **WHEN** `opencode.json` already contains a bash permission rule
- **THEN** install SHALL preserve it while adding missing destructive-command deny defaults

#### Scenario: Env file rules
- **WHEN** permission read rules are an object
- **THEN** install SHALL deny `*.env` and `*.env.*` reads while allowing `*.env.example`

### Requirement: OS Sandbox Plugin Merge
Install with `--with-opencode-os-sandbox` SHALL add `opencode-sandbox` to root `opencode.json` plugin configuration without replacing existing plugins.

#### Scenario: Existing plugin array
- **WHEN** `opencode.json` already has a plugin array
- **THEN** install SHALL preserve existing plugin entries and add `opencode-sandbox` if missing

#### Scenario: Existing plugin string
- **WHEN** `opencode.json` has a single plugin string
- **THEN** install SHALL convert it to an array while preserving the existing plugin

### Requirement: OpenCode Config Validation
Install SHALL reject malformed OpenCode JSON config shapes instead of silently rewriting them.

#### Scenario: Non-object config
- **WHEN** an OpenCode config file parses to a non-object or array
- **THEN** install SHALL throw an error describing the invalid config object

#### Scenario: Invalid plugin type
- **WHEN** a plugin config exists but is neither string nor array
- **THEN** install SHALL throw an error describing the invalid plugin shape

### Requirement: Remote Install
`remote-install.ts` SHALL clone the configured release of the worktree repository into a temporary directory and run its `install.ts`, forwarding all arguments except `--ref`.

#### Scenario: Default ref
- **WHEN** remote install runs without `--ref` and `WORKTREE_REF` is unset
- **THEN** it SHALL clone ref `v2.0.0`

#### Scenario: Clone failure
- **WHEN** git clone fails
- **THEN** remote install SHALL print a clone failure message and exit `1`

#### Scenario: Temporary cleanup
- **WHEN** remote install exits after success or failure
- **THEN** it SHALL remove the temporary clone directory best-effort

### Requirement: Installer Idempotency
Install SHALL be safe to re-run and SHALL converge generated files and config entries without duplicate plugin registrations.

#### Scenario: Re-run install
- **WHEN** install runs repeatedly with the same options
- **THEN** generated file layout and plugin config SHALL remain stable

