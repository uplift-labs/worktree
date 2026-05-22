import fs from "node:fs"
import { git } from "./exec.ts"

export type ScanResult = { clean: boolean; summary: string; tracked: number; untracked: number }

export function scanUncommitted(worktree: string, options: { ignoreDeletions?: boolean } = {}): ScanResult {
  if (!fs.existsSync(worktree) || !fs.statSync(worktree).isDirectory()) return { clean: true, summary: "", tracked: 0, untracked: 0 }
  git(["update-index", "--refresh"], worktree)
  const statusResult = git(["status", "--porcelain"], worktree)
  let lines = statusResult.status === 0 ? statusResult.stdout.split(/\r?\n/).filter(Boolean) : []
  if (options.ignoreDeletions) lines = lines.filter((line) => !line.startsWith(" D "))
  const untracked = lines.filter((line) => line.startsWith("??")).length
  const tracked = lines.length - untracked
  const clean = tracked === 0 && untracked === 0
  return { clean, summary: clean ? "" : `${tracked} modified, ${untracked} untracked`, tracked, untracked }
}
