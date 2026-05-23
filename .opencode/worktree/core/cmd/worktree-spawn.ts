#!/usr/bin/env node
import { isMainModule, needValue, UsageError } from "../lib/exec.ts"
import { spawnWorktrees } from "../lib/worktree-spawn.ts"

const USAGE = "usage: worktree-spawn.ts --repo <dir> [-n <count>] [--worktrees-dir <rel>] [--branch-prefix <prefix>] [--print] [--no-dirty]"

export function worktreeSpawn(argv: string[]): number {
  let repo = ""
  let count = 1
  let worktreesDir = ".opencode/worktree/worktrees"
  let branchPrefix = "wt"
  let printOnly = false
  let copyDirty = true

  for (let i = 0; i < argv.length;) {
    const arg = argv[i]
    switch (arg) {
      case "--repo": repo = needValue(argv, i, USAGE); i += 2; break
      case "-n":
      case "--count": count = Number.parseInt(needValue(argv, i, USAGE), 10); i += 2; break
      case "--worktrees-dir": worktreesDir = needValue(argv, i, USAGE); i += 2; break
      case "--branch-prefix": branchPrefix = needValue(argv, i, USAGE); i += 2; break
      case "--print": printOnly = true; i += 1; break
      case "--no-dirty": copyDirty = false; i += 1; break
      case "-h":
      case "--help": throw new UsageError(USAGE)
      default:
        console.error(`unknown arg: ${arg}`)
        throw new UsageError(USAGE)
    }
  }
  if (!repo) throw new UsageError(USAGE)
  if (!Number.isFinite(count) || count < 1) throw new UsageError(USAGE)

  const result = spawnWorktrees({ repo, count, worktreesDir, branchPrefix, copyDirty, printOnly })
  for (const item of result.worktrees) console.log(item.path)
  if (!result.wtAvailable || printOnly) {
    console.log("manual launch commands:")
    for (const command of result.manualCommands) console.log(`  ${command}`)
  }
  return 0
}

if (isMainModule(import.meta.url)) {
  try {
    process.exit(worktreeSpawn(process.argv.slice(2)))
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message)
      process.exit(error.status)
    }
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
