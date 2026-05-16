#!/usr/bin/env node
import fs from "node:fs"
import { isMainModule, needValue, UsageError } from "../lib/exec.ts"
import { scanUncommitted } from "../lib/scan-uncommitted.ts"

const USAGE = "usage: sandbox-merge-gate.ts --worktree <dir>"

export function sandboxMergeGate(argv: string[]): number {
  let worktree = ""
  for (let i = 0; i < argv.length;) {
    const arg = argv[i]
    switch (arg) {
      case "--worktree": worktree = needValue(argv, i, USAGE); i += 2; break
      case "-h":
      case "--help": throw new UsageError(USAGE)
      default:
        console.error(`unknown arg: ${arg}`)
        throw new UsageError(USAGE)
    }
  }
  if (!worktree) throw new UsageError(USAGE)
  if (!fs.existsSync(worktree) || !fs.statSync(worktree).isDirectory()) {
    console.log(`not a directory: ${worktree}`)
    return 1
  }
  const scan = scanUncommitted(worktree)
  if (!scan.clean) {
    console.log("sandbox-merge-gate: BLOCKED")
    console.log(`filesystem not clean: ${scan.summary} - commit or stash before merge`)
    return 1
  }
  return 0
}

if (isMainModule(import.meta.url)) {
  try {
    process.exit(sandboxMergeGate(process.argv.slice(2)))
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message)
      process.exit(error.status)
    }
    console.log(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
