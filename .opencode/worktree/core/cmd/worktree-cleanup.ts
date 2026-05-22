#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { git, isMainModule, needValue, UsageError } from "../lib/exec.ts"
import { cleanupLog } from "../lib/cleanup-log.ts"
import { gitCommonDir, hasInProgressOperation, mainBranch } from "../lib/git-context.ts"
import { scanUncommitted } from "../lib/scan-uncommitted.ts"
import { markerPath, markerReadInitialHead, markerReadValue, markerTouch } from "../lib/ttl-marker.ts"
import { worktreeLifecycle } from "./worktree-lifecycle.ts"

const USAGE = "usage: worktree-cleanup.ts --repo <dir> --session <id> [--trust-dead] [--worktrees-dir <rel>] [--branch-prefix <glob>]"
const WORKTREE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

export function worktreeCleanup(argv: string[]): number {
  let repo = ""
  let session = ""
  let trustDead = false
  let worktreesDir = ".worktree/worktrees"
  let branchPrefix = "wt-*"

  for (let i = 0; i < argv.length;) {
    const arg = argv[i]
    switch (arg) {
      case "--repo": repo = needValue(argv, i, USAGE); i += 2; break
      case "--session": session = needValue(argv, i, USAGE); i += 2; break
      case "--trust-dead": trustDead = true; i += 1; break
      case "--worktrees-dir": worktreesDir = needValue(argv, i, USAGE); i += 2; break
      case "--branch-prefix": branchPrefix = needValue(argv, i, USAGE); i += 2; break
      case "-h":
      case "--help": throw new UsageError(USAGE)
      default:
        console.error(`unknown arg: ${arg}`)
        throw new UsageError(USAGE)
    }
  }
  if (!repo || !session) throw new UsageError(USAGE)

  let common = ""
  let marker = ""
  try {
    common = gitCommonDir(repo)
    marker = markerPath(common, session)
  } catch {
    return 0
  }
  if (!fs.existsSync(marker)) return 0
  const branch = markerReadValue(marker)
  const worktree = path.join(repo, worktreesDir, branch)
  if (!branch || !fs.existsSync(worktree)) return 0

  let canCommit = true
  if (hasInProgressOperation(worktree)) {
    canCommit = false
    console.error(`[worktree] cleanup: in-progress merge/rebase in ${branch} - skipping capture-commit.`)
  }
  if (canCommit && git(["symbolic-ref", "-q", "HEAD"], worktree).status !== 0) {
    canCommit = false
    console.error(`[worktree] cleanup: detached HEAD in ${branch} - skipping capture-commit.`)
  }

  if (canCommit) {
    git(["add", "-A"], worktree)
    if (git(["diff", "--cached", "--quiet"], worktree).status !== 0) {
      if (git(["commit", "-q", "-m", "chore(worktree-cleanup): capture pending work"], worktree).status !== 0) {
        console.error(`[worktree] cleanup: capture-commit failed on ${branch} - worktree left as-is.`)
      }
    }
  }

  const rootBranch = mainBranch(repo)
  const initHead = markerReadInitialHead(marker)
  const curHead = git(["rev-parse", "HEAD"], worktree).stdout.trim()
  let freshGuardOk = true
  if (!trustDead && (!initHead || !curHead || curHead === initHead)) freshGuardOk = false

  if (canCommit && rootBranch && freshGuardOk && git(["merge-base", "--is-ancestor", branch, rootBranch], worktree).status === 0 && scanUncommitted(worktree, { ignoreDeletions: true }).clean) {
    try {
      fs.rmSync(marker, { force: true })
      fs.rmSync(`${marker}.hb`, { force: true })
    } catch {
      // lifecycle TTL remains
    }
    cleanupLog(WORKTREE_ROOT, "RELEASE", session, branch, "cleanup-phase2-self-release")
  }

  if (fs.existsSync(marker)) markerTouch(marker)
  worktreeLifecycle(["--repo", repo, "--worktrees-dir", worktreesDir, "--branch-prefix", branchPrefix], { quiet: true })
  return 0
}

if (isMainModule(import.meta.url)) {
  try {
    process.exit(worktreeCleanup(process.argv.slice(2)))
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message)
      process.exit(error.status)
    }
    process.exit(0)
  }
}
