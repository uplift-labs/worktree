#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { isMainModule, needValue, UsageError } from "../lib/exec.ts"

const USAGE = "usage: reflection-rescue.ts --repo <dir> [--worktrees-dir <rel>]"

export function reflectionRescue(argv: string[]): number {
  let repo = ""
  let worktreesDir = ".worktree/worktrees"
  const reflectionDir = process.env.REFLECTION_RESCUE_DIR || ".reinforce/reflections"

  for (let i = 0; i < argv.length;) {
    const arg = argv[i]
    switch (arg) {
      case "--repo": repo = needValue(argv, i, USAGE); i += 2; break
      case "--worktrees-dir": worktreesDir = needValue(argv, i, USAGE); i += 2; break
      case "-h":
      case "--help": throw new UsageError(USAGE)
      default:
        console.error(`unknown arg: ${arg}`)
        throw new UsageError(USAGE)
    }
  }
  if (!repo) throw new UsageError(USAGE)
  if (!fs.existsSync(repo)) return 0

  const parent = path.join(repo, worktreesDir)
  const mainReflections = path.join(repo, reflectionDir)
  if (!fs.existsSync(parent)) return 0
  try { fs.mkdirSync(mainReflections, { recursive: true }) } catch { return 0 }

  let rescued = 0
  let deduped = 0
  for (const branch of fs.readdirSync(parent)) {
    const worktree = path.join(parent, branch)
    const sourceDir = path.join(worktree, reflectionDir)
    if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) continue
    for (const name of fs.readdirSync(sourceDir)) {
      if (!name.endsWith(".md")) continue
      const source = path.join(sourceDir, name)
      if (!fs.statSync(source).isFile()) continue
      const dest = path.join(mainReflections, name)
      if (fs.existsSync(dest)) {
        try {
          fs.rmSync(source, { force: true })
          deduped += 1
          console.log(`deduped:   ${name}  from ${branch}`)
        } catch {
          // retry on next lifecycle pass
        }
        continue
      }
      try {
        fs.copyFileSync(source, dest)
        fs.rmSync(source, { force: true })
        rescued += 1
        console.log(`rescued:   ${name}  from ${branch}`)
      } catch {
        // fail open
      }
    }
  }
  if (rescued + deduped > 0) console.log(`reflection-rescue: rescued=${rescued} deduped=${deduped}`)
  return 0
}

if (isMainModule(import.meta.url)) {
  try {
    process.exit(reflectionRescue(process.argv.slice(2)))
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message)
      process.exit(error.status)
    }
    process.exit(0)
  }
}
