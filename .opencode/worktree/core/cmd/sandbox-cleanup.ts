#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { git, isMainModule, needValue, UsageError } from "../lib/exec.ts"
import { cleanupLog } from "../lib/cleanup-log.ts"
import { gitCommonDir, hasInProgressOperation, mainBranch } from "../lib/git-context.ts"
import { scanUncommitted } from "../lib/scan-uncommitted.ts"
import { markerPath, markerReadInitialHead, markerReadValue, markerTouch } from "../lib/ttl-marker.ts"
import { sandboxLifecycle } from "./sandbox-lifecycle.ts"

const USAGE = "usage: sandbox-cleanup.ts --repo <dir> --session <id> [--trust-dead] [--worktrees-dir <rel>] [--branch-prefix <glob>]"
const SANDBOX_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

export function sandboxCleanup(argv: string[]): number {
  let repo = ""
  let session = ""
  let trustDead = false
  let worktreesDir = ".sandbox/worktrees"
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
  const sandbox = path.join(repo, worktreesDir, branch)
  if (!branch || !fs.existsSync(sandbox)) return 0

  let canCommit = true
  if (hasInProgressOperation(sandbox)) {
    canCommit = false
    console.error(`[sandbox] cleanup: in-progress merge/rebase in ${branch} - skipping capture-commit.`)
  }
  if (canCommit && git(["symbolic-ref", "-q", "HEAD"], sandbox).status !== 0) {
    canCommit = false
    console.error(`[sandbox] cleanup: detached HEAD in ${branch} - skipping capture-commit.`)
  }

  if (canCommit) {
    git(["add", "-A"], sandbox)
    if (git(["diff", "--cached", "--quiet"], sandbox).status !== 0) {
      if (git(["commit", "-q", "-m", "chore(sandbox-cleanup): capture pending work"], sandbox).status !== 0) {
        console.error(`[sandbox] cleanup: capture-commit failed on ${branch} - sandbox left as-is.`)
      }
    }
  }

  const rootBranch = mainBranch(repo)
  const initHead = markerReadInitialHead(marker)
  const curHead = git(["rev-parse", "HEAD"], sandbox).stdout.trim()
  let freshGuardOk = true
  if (!trustDead && (!initHead || !curHead || curHead === initHead)) freshGuardOk = false

  if (canCommit && rootBranch && freshGuardOk && git(["merge-base", "--is-ancestor", branch, rootBranch], sandbox).status === 0 && scanUncommitted(sandbox, { ignoreDeletions: true }).clean) {
    try {
      fs.rmSync(marker, { force: true })
      fs.rmSync(`${marker}.hb`, { force: true })
    } catch {
      // lifecycle TTL remains
    }
    cleanupLog(SANDBOX_ROOT, "RELEASE", session, branch, "cleanup-phase2-self-release")
  }

  if (fs.existsSync(marker)) markerTouch(marker)
  sandboxLifecycle(["--repo", repo, "--worktrees-dir", worktreesDir, "--branch-prefix", branchPrefix], { quiet: true })
  return 0
}

if (isMainModule(import.meta.url)) {
  try {
    process.exit(sandboxCleanup(process.argv.slice(2)))
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message)
      process.exit(error.status)
    }
    process.exit(0)
  }
}
