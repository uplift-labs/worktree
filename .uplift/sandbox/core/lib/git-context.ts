import fs from "node:fs"
import path from "node:path"
import { git, gitOk, gitOutput, isWindowsAbsolute } from "./exec.ts"

export function gitRoot(dir = "."): string {
  const common = gitOutput(["rev-parse", "--git-common-dir"], dir)
  if (common === ".git") return gitOutput(["rev-parse", "--show-toplevel"], dir)
  const commonAbs = path.isAbsolute(common) || isWindowsAbsolute(common) ? path.resolve(common) : path.resolve(dir, common)
  return path.dirname(commonAbs)
}

export function gitCommonDir(dir = "."): string {
  const root = gitRoot(dir)
  const common = gitOutput(["rev-parse", "--git-common-dir"], root)
  return path.isAbsolute(common) || isWindowsAbsolute(common) ? path.resolve(common) : path.resolve(root, common)
}

export function isLinkedWorktree(dir = "."): boolean | null {
  const result = git(["rev-parse", "--git-common-dir"], dir)
  if (result.status !== 0) return null
  return result.stdout.trim() !== ".git"
}

export function hasInProgressOperation(dir = "."): boolean {
  const mergeHead = gitPath(dir, "MERGE_HEAD")
  const rebaseHead = gitPath(dir, "REBASE_HEAD")
  const rebaseApply = gitPath(dir, "rebase-apply")
  const rebaseMerge = gitPath(dir, "rebase-merge")
  return (!!mergeHead && fs.existsSync(mergeHead)) || (!!rebaseHead && fs.existsSync(rebaseHead)) || (!!rebaseApply && fs.existsSync(rebaseApply)) || (!!rebaseMerge && fs.existsSync(rebaseMerge))
}

function gitPath(dir: string, name: string): string {
  try {
    return gitOutput(["rev-parse", "--git-path", name], dir)
  } catch {
    return ""
  }
}

export function mainBranch(dir = "."): string {
  try {
    const ref = gitOutput(["symbolic-ref", "refs/remotes/origin/HEAD"], dir)
    const prefix = "refs/remotes/origin/"
    if (ref.startsWith(prefix)) return ref.slice(prefix.length)
  } catch {
    // fall back below
  }
  for (const candidate of ["main", "master"]) {
    if (gitOk(["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`], dir)) return candidate
  }
  return "main"
}

export type WorktreeInfo = { path: string; branch: string; head?: string }

export function listWorktrees(dir = "."): WorktreeInfo[] {
  const result = git(["worktree", "list", "--porcelain"], dir)
  if (result.status !== 0) return []
  const entries: WorktreeInfo[] = []
  let currentPath = ""
  let head = ""
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length)
      head = ""
      continue
    }
    if (line.startsWith("HEAD ")) {
      head = line.slice("HEAD ".length)
      continue
    }
    if (line.startsWith("branch ")) {
      const branchRef = line.slice("branch ".length)
      const prefix = "refs/heads/"
      const branch = branchRef.startsWith(prefix) ? branchRef.slice(prefix.length) : branchRef
      if (currentPath && branch) entries.push({ path: currentPath, branch, head })
      currentPath = ""
      head = ""
    }
  }
  return entries
}
