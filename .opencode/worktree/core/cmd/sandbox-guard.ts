#!/usr/bin/env node
import path from "node:path"
import fs from "node:fs"
import { isMainModule, needValue, toPosix, UsageError } from "../lib/exec.ts"
import { gitCommonDir, gitRoot } from "../lib/git-context.ts"
import { markerPath, markerReadValue } from "../lib/ttl-marker.ts"

const USAGE = "usage: sandbox-guard.ts --session <id> --file <path> [--repo <dir>] [--worktrees-dir <rel>]"

function norm(value: string): string {
  return toPosix(path.resolve(value)).replace(/\/+/g, "/").toLowerCase()
}

export function sandboxGuard(argv: string[]): number {
  let session = ""
  let file = ""
  let repo = ""
  let worktreesDir = ".sandbox/worktrees"

  for (let i = 0; i < argv.length;) {
    const arg = argv[i]
    switch (arg) {
      case "--session": session = needValue(argv, i, USAGE); i += 2; break
      case "--file": file = needValue(argv, i, USAGE); i += 2; break
      case "--repo": repo = needValue(argv, i, USAGE); i += 2; break
      case "--worktrees-dir": worktreesDir = needValue(argv, i, USAGE); i += 2; break
      case "-h":
      case "--help": throw new UsageError(USAGE)
      default:
        console.error(`unknown arg: ${arg}`)
        throw new UsageError(USAGE)
    }
  }
  if (!session || !file) throw new UsageError(USAGE)

  let repoRoot = ""
  let common = ""
  try {
    repoRoot = gitRoot(repo || ".")
    common = gitCommonDir(repoRoot)
  } catch {
    return 0
  }

  let marker = ""
  try { marker = markerPath(common, session) } catch { return 0 }
  if (!fs.existsSync(marker)) return 0
  const branch = markerReadValue(marker)
  if (!branch) return 0

  const sandbox = path.join(repoRoot, worktreesDir, branch)
  const nf = norm(file)
  const nr = norm(repoRoot)
  const ns = norm(sandbox)

  if (nf === ns || nf.startsWith(`${ns}/`)) return 0
  if (nf === nr || nf.startsWith(`${nr}/`)) {
    console.log(`sandbox-guard: edit blocked - session ${session} has sandbox at ${sandbox}, but target is in main repo (${file}). Edit the sandbox copy and merge via git.`)
    return 1
  }
  return 0
}

if (isMainModule(import.meta.url)) {
  try {
    process.exit(sandboxGuard(process.argv.slice(2)))
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message)
      process.exit(error.status)
    }
    process.exit(0)
  }
}
