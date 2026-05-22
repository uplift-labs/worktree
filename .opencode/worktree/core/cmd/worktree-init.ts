#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { git, gitOutput, isMainModule, needValue, UsageError } from "../lib/exec.ts"
import { gitCommonDir, gitRoot, isLinkedWorktree, mainBranch } from "../lib/git-context.ts"
import { markerIsFresh, markerPath, markerReadValue, markerSafeId, markerWrite } from "../lib/ttl-marker.ts"

const USAGE = "usage: worktree-init.ts --repo <dir> --session <id> [--base <branch>] [--worktrees-dir <rel>] [--branch-prefix <prefix>]"
const MARKER_TTL = 86400

export function worktreeInit(argv: string[]): number {
  let repo = ""
  let session = ""
  let base = ""
  let worktreesDir = ".worktree/worktrees"
  let branchPrefix = "wt"

  for (let i = 0; i < argv.length;) {
    const arg = argv[i]
    switch (arg) {
      case "--repo": repo = needValue(argv, i, USAGE); i += 2; break
      case "--session": session = needValue(argv, i, USAGE); i += 2; break
      case "--base": base = needValue(argv, i, USAGE); i += 2; break
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

  const linked = isLinkedWorktree(repo)
  if (linked === true) {
    console.log(`refusing to nest: ${repo} is already a linked worktree`)
    return 1
  }
  if (linked === null) {
    console.log(`not a git repository: ${repo}`)
    return 1
  }

  let root = ""
  let common = ""
  try {
    root = gitRoot(repo)
    common = gitCommonDir(repo)
  } catch {
    console.log(`cannot resolve git root: ${repo}`)
    return 1
  }

  const current = git(["branch", "--show-current"], root).stdout.trim()
  if (current !== "main" && current !== "master") return 0
  if (!base) base = mainBranch(root)

  const safe = markerSafeId(session)
  if (!safe) throw new UsageError(USAGE)
  const branch = `${branchPrefix}-${safe}`
  const worktreePath = path.join(root, worktreesDir, branch)
  const marker = markerPath(common, session)

  if (markerIsFresh(marker, MARKER_TTL)) {
    const existing = markerReadValue(marker)
    const existingPath = existing ? path.join(root, worktreesDir, existing) : ""
    if (existingPath && fs.existsSync(existingPath)) {
      console.log(existingPath)
      return 0
    }
  }

  fs.mkdirSync(path.dirname(worktreePath), { recursive: true })
  let created = git(["worktree", "add", worktreePath, "-b", branch, base], root).status === 0
  if (!created) created = git(["worktree", "add", worktreePath, branch], root).status === 0
  if (!created) {
    console.log("worktree creation failed")
    return 1
  }

  const initHead = (() => {
    try { return gitOutput(["rev-parse", "HEAD"], worktreePath) } catch { return "" }
  })()

  if (!markerWrite(marker, branch, initHead)) {
    console.log(`marker write failed: ${marker}`)
    git(["worktree", "remove", "--force", worktreePath], root)
    git(["branch", "-D", branch], root)
    return 1
  }

  console.log(worktreePath)
  return 0
}

if (isMainModule(import.meta.url)) {
  try {
    process.exit(worktreeInit(process.argv.slice(2)))
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message)
      process.exit(error.status)
    }
    console.log(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
