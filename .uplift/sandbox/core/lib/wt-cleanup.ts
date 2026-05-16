import fs from "node:fs"
import path from "node:path"
import { git, gitOk, safeRmTree } from "./exec.ts"
import { scanUncommitted } from "./scan-uncommitted.ts"

export type RemoveStatus = { code: number; line: string; removed: boolean; preserved: boolean }

export function pruneWorktreeMetadata(repo: string): void {
  git(["worktree", "prune"], repo)
}

export function removeIfMerged(repo: string, worktreePath: string, worktreeBranch: string, mainBranch: string, detail = ""): RemoveStatus {
  if (!gitOk(["merge-base", "--is-ancestor", worktreeBranch, mainBranch], repo)) {
    return { code: 1, line: `PRESERVED ${worktreeBranch} — unmerged (${detail || "needs manual review"})`, removed: false, preserved: true }
  }

  const scan = scanUncommitted(worktreePath, { ignoreDeletions: true })
  if (!scan.clean) {
    const suffix = detail && detail !== "needs manual review" ? ` | ${detail}` : ""
    return { code: 2, line: `PRESERVED ${worktreeBranch} — unsaved work: ${scan.summary}${suffix}`, removed: false, preserved: true }
  }

  if (git(["worktree", "remove", worktreePath], repo).status === 0) {
    git(["branch", "-d", worktreeBranch], repo)
    return { code: 0, line: `REMOVED ${worktreeBranch}`, removed: true, preserved: false }
  }

  return { code: 3, line: `PRESERVED ${worktreeBranch} — merged but locked`, removed: false, preserved: true }
}

export function sweepOrphanBranches(repo: string, prefixGlob: string, mainBranch: string, skipBranches = ""): string[] {
  const result = git(["branch", "--list", prefixGlob], repo)
  if (result.status !== 0) return []
  const worktreePorcelain = git(["worktree", "list", "--porcelain"], repo).stdout
  const lines: string[] = []
  for (const raw of result.stdout.split(/\r?\n/)) {
    let branch = raw.trim()
    if (!branch) continue
    if (branch.startsWith("* ")) branch = branch.slice(2).trim()
    if (skipBranches.includes(` ${branch} `)) continue
    if (worktreePorcelain.includes(`branch refs/heads/${branch}`)) continue
    if (!gitOk(["merge-base", "--is-ancestor", branch, mainBranch], repo)) continue
    if (git(["branch", "-d", branch], repo).status === 0) lines.push(`REMOVED branch ${branch}`)
  }
  return lines
}

export function sweepResidualDirs(parent: string): string[] {
  if (!fs.existsSync(parent)) return []
  const lines: string[] = []
  for (const name of fs.readdirSync(parent)) {
    const dir = path.join(parent, name)
    if (!fs.statSync(dir).isDirectory()) continue
    if (fs.existsSync(path.join(dir, ".git"))) continue
    const count = countVisibleFiles(dir, 5)
    if (count === 0) {
      safeRmTree(dir)
      if (!fs.existsSync(dir)) lines.push(`REMOVED residual ${name}`)
    } else {
      lines.push(`PRESERVED residual ${name} — ${count}+ files, no .git`)
    }
  }
  return lines
}

function countVisibleFiles(dir: string, limit: number): number {
  let count = 0
  const walk = (current: string) => {
    if (count >= limit) return
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (count >= limit) return
      const file = path.join(current, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (entry.isFile() && !entry.name.startsWith(".")) count += 1
    }
  }
  try {
    walk(dir)
  } catch {
    return count
  }
  return count
}
