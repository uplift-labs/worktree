#!/usr/bin/env node
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { isMainModule, needValue, safeRmTree, UsageError } from "./core/lib/exec.ts"

const USAGE = [
  "remote-install.ts - fetch worktree and install into the current repo.",
  "",
  "Usage:",
  "  node remote-install.ts [--ref <git-ref>] [--prefix <dir>] [--with-opencode-permissions] [--with-opencode-os-sandbox]",
].join("\n")

const REPO_URL = "https://github.com/uplift-labs/worktree.git"
const DEFAULT_REF = process.env.WORKTREE_REF || "v2.0.0"

export function remoteInstall(argv: string[]): number {
  let ref = DEFAULT_REF
  const forward: string[] = []
  for (let i = 0; i < argv.length;) {
    const arg = argv[i]
    switch (arg) {
      case "--ref": ref = needValue(argv, i, USAGE); i += 2; break
      case "-h":
      case "--help": throw new UsageError(USAGE)
      default: forward.push(arg); i += 1; break
    }
  }

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-"))
  try {
    const checkout = path.join(temp, "worktree")
    console.log(`[remote-install] cloning worktree ${ref}...`)
    const clone = spawnSync("git", ["clone", "--depth", "1", "--branch", ref, "--quiet", REPO_URL, checkout], { encoding: "utf8", windowsHide: true })
    if (clone.status !== 0) {
      console.error("[remote-install] git clone failed")
      if (clone.stderr) console.error(clone.stderr.trim())
      return 1
    }
    console.log("[remote-install] running install.ts...")
    const install = spawnSync(process.execPath, [path.join(checkout, "install.ts"), ...forward], { stdio: "inherit", windowsHide: true })
    return typeof install.status === "number" ? install.status : 1
  } finally {
    safeRmTree(temp)
  }
}

if (isMainModule(import.meta.url)) {
  try {
    process.exit(remoteInstall(process.argv.slice(2)))
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message)
      process.exit(error.status)
    }
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
