# AGENTS.md

OpenCode-focused repository instructions for `worktree`. `CONTRACT.md` is the public CLI source of truth.

## OpenSpec Development Flow

- All project development changes MUST go through the OpenSpec flow. This includes feature work, bug fixes, behavior changes, refactors, tests, docs that describe behavior, tooling changes, and repository instruction changes.
- When the user asks for a project change, proactively enforce OpenSpec instead of making direct edits: use `openspec-explore` for unclear requirements, `openspec-propose` to create or update proposal artifacts before implementation, `openspec-apply-change` to implement approved tasks, and `openspec-archive-change` after completion.
- Do not bypass OpenSpec because a requested change looks small. Only skip the flow for purely informational requests, read-only investigation or review, or when a higher-priority instruction explicitly requires a different path; state the reason before proceeding outside the OpenSpec flow.
- If the user asks for implementation without an existing OpenSpec change, pause direct edits and drive the proposal/task flow first. Do not proceed outside OpenSpec unless a higher-priority instruction explicitly requires a different path, and state that reason before proceeding.

## Worktree Discipline

- During OpenCode sessions, `OPENCODE_WORKTREE_PATH` is the active project root; do file reads and edits there, not in the main checkout.
- OpenCode may still display the original repo/branch because the plugin virtualizes supported tool paths into the active worktree. Trust `OPENCODE_WORKTREE_PATH`, tool working dirs, and `git status` run from the tool.
- When the user asks to land, ship, upload, or fix changes in `main`, complete the path: verify, commit, merge or fast-forward `main`, push, then dogfood the installed/current state when feasible.
- Do not leave completed work only in an isolated worktree branch unless the user explicitly asks for a worktree-only change or a blocker prevents landing. If blocked, report the blocker and the safest next command.

## Commands

- `npm run verify` runs TypeScript typecheck and the Node test suite.
- `npm run typecheck` runs `tsc --noEmit`.
- `npm test` runs `node --test tests`.
- `node install.ts --target "$PWD"` syncs this repo's dogfood install under `.opencode/worktree/` plus project-local `.opencode/` plugin files; run it after touching `core/`, `adapters/opencode/`, or installer code.
- `node install.ts --target <repo> [--with-opencode-permissions|--with-opencode-os-sandbox]` is idempotent and uses Node for JSON config merges.
- Node.js `24+` is required because TypeScript files are executed directly.

## Source Boundaries

- `core/cmd/*.ts` are the stable public CLI. Flags, stdout shape, and exit codes are the contract in `CONTRACT.md`.
- `core/lib/*.ts` are internal. Do not import them from adapters or external callers unless the contract explicitly allows it.
- `adapters/opencode/` is the OpenCode translation/plugin layer. Add OpenCode-specific parsing or routing there, not in `core/`.
- Root `core/` and `adapters/opencode/` are the source of truth. `.opencode/worktree/*` and `.opencode/*` plugin files are installed mirrors used for dogfooding; sync them with `node install.ts` instead of hand-editing unless testing installer output.

## Contracts

- Core exit codes are fixed: `0` allow/success, `1` deny/failure with reason on stdout, `2` bad usage. Preserve the fail-open policy when git context cannot be resolved.
- Changing any `core/cmd/` flag, output, exit code, marker format, or lifecycle phase requires updating `CONTRACT.md` and tests in the same change.
- Markers live at `<git-common-dir>/worktree-markers/<session-id>` with fields `branch epoch initial_head`; `core/lib/ttl-marker.ts` owns marker reads/writes.
- Source CLI default worktrees dir is `.opencode/worktree/worktrees`; installed OpenCode integration also uses `.opencode/worktree/worktrees`.

## Lifecycle And Hooks

- `worktree-lifecycle.ts` order is load-bearing: reflection rescue, `git worktree prune`, TTL marker reclaim, proactive marker release, merged worktree cleanup, orphan branch sweep, residual dir sweep.
- Idle hooks are heartbeat-only. Cleanup belongs to OpenCode `session.deleted`, process exit, or heartbeat parent-death cleanup.
- Session cleanup capture-commits pending worktree work but never merges to `main`; merging is always a deliberate user action protected by the merge gate.
- The installed `pre-merge-commit` hook validates cleanliness of the worktree being merged, not the target repo's merge-staged index. Keep non-worktree/no-match cases fail-open.

## Tests

- Tests use Node's built-in test runner and real temp git repos from `fs.mkdtempSync` plus `git init`.
- Keep tests cross-platform; avoid shell-specific syntax and shell-only assumptions.
- The OpenCode adapter is TypeScript/TSX. Preserve project plugin shapes and OpenCode config schemas when editing plugin or TUI registration behavior.

## Finish Loop

- After making repository changes, dogfood before reporting completion: run the relevant test/install/verification cycle for the touched area, and state the exact commands and results.
- For non-trivial diffs, run `@worktree-reviewer` before reporting completion or landing changes. This does not replace `npm run verify`.
