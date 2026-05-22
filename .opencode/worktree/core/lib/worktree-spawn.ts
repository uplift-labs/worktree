import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { gitOutput, run } from "./exec.ts"

export type WorktreeSpawnOptions = {
  repo: string
  count?: number
  worktreesDir?: string
  branchPrefix?: string
  copyDirty?: boolean
  launch?: boolean
  printOnly?: boolean
}

export type SpawnedWorktree = {
  path: string
  branch: string
  launched: boolean
}

export type WorktreeSpawnResult = {
  repo: string
  worktrees: SpawnedWorktree[]
  wtAvailable: boolean
  manualCommands: string[]
}

type CreatedWorktree = { path: string; branch: string }

const DEFAULT_WORKTREES_DIR = ".worktree/worktrees"
const DEFAULT_BRANCH_PREFIX = "wt"

export function spawnWorktrees(options: WorktreeSpawnOptions): WorktreeSpawnResult {
  const repo = gitOutput(["rev-parse", "--show-toplevel"], options.repo || ".")
  const count = Math.max(1, Math.min(50, Math.trunc(options.count || 1)))
  const worktreesDir = options.worktreesDir || DEFAULT_WORKTREES_DIR
  const branchPrefix = options.branchPrefix || DEFAULT_BRANCH_PREFIX
  const copyDirty = options.copyDirty !== false
  const launch = options.launch !== false && options.printOnly !== true
  const base = gitOutput(["rev-parse", "HEAD"], repo)
  const parent = path.resolve(repo, worktreesDir)
  const created: CreatedWorktree[] = []

  try {
    fs.mkdirSync(parent, { recursive: true })
    for (let i = 0; i < count; i += 1) {
      const branch = uniqueBranch(repo, branchPrefix)
      const worktreePath = path.join(parent, branch)
      const add = run("git", ["-C", repo, "worktree", "add", worktreePath, "-b", branch, base], { timeout: 30000 })
      if (add.status !== 0) throw new Error((add.stderr || add.stdout || "git worktree add failed").trim())
      created.push({ path: worktreePath, branch })
      if (copyDirty) copyDirtyState(repo, worktreePath)
    }
  } catch (error) {
    cleanupCreated(repo, created)
    throw error
  }

  const wtAvailable = commandAvailable("wt.exe")
  const worktrees: SpawnedWorktree[] = []
  const manualCommands: string[] = []
  for (const item of created) {
    const command = `opencode ${quoteArg(item.path)}`
    manualCommands.push(command)
    const launched = launch && wtAvailable ? launchWindowsTerminal(item.path, item.branch) : false
    worktrees.push({ ...item, launched })
  }

  return { repo, worktrees, wtAvailable, manualCommands }
}

function uniqueBranch(repo: string, prefix: string): string {
  for (let i = 0; i < 100; i += 1) {
    const suffix = `${Date.now().toString(36)}-${process.pid.toString(36)}-${i.toString(36)}`
    const branch = `${prefix}-${suffix}`
    if (run("git", ["-C", repo, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).status !== 0) return branch
  }
  throw new Error("could not allocate unique worktree branch")
}

function copyDirtyState(source: string, target: string): void {
  applyPatch(source, target, ["diff", "--cached", "--binary"], ["apply", "--index", "--whitespace=nowarn"])
  applyPatch(source, target, ["diff", "--binary"], ["apply", "--whitespace=nowarn"])
  copyUntracked(source, target)
}

function applyPatch(source: string, target: string, diffArgs: string[], applyArgs: string[]): void {
  const diff = spawnSync("git", ["-C", source, ...diffArgs], {
    encoding: "buffer",
    maxBuffer: 100 * 1024 * 1024,
    windowsHide: true,
  })
  if (diff.status !== 0) throw new Error(commandOutput(diff.stderr) || commandOutput(diff.stdout) || `git ${diffArgs.join(" ")} failed`)
  const patch = Buffer.isBuffer(diff.stdout) ? diff.stdout : Buffer.from(diff.stdout || "")
  if (patch.length === 0) return
  const apply = spawnSync("git", ["-C", target, ...applyArgs], {
    input: patch,
    encoding: "buffer",
    maxBuffer: 100 * 1024 * 1024,
    windowsHide: true,
  })
  if (apply.status !== 0) throw new Error(commandOutput(apply.stderr) || commandOutput(apply.stdout) || `git ${applyArgs.join(" ")} failed`)
}

function copyUntracked(source: string, target: string): void {
  const result = spawnSync("git", ["-C", source, "ls-files", "--others", "--exclude-standard", "-z"], {
    encoding: "buffer",
    maxBuffer: 100 * 1024 * 1024,
    windowsHide: true,
  })
  if (result.status !== 0) throw new Error(commandOutput(result.stderr) || commandOutput(result.stdout) || "git ls-files failed")
  const files = Buffer.from(result.stdout || "").toString("utf8").split("\0").filter(Boolean)
  for (const rel of files) {
    const sourceFile = path.join(source, rel)
    const targetFile = path.join(target, rel)
    const stat = fs.lstatSync(sourceFile)
    fs.mkdirSync(path.dirname(targetFile), { recursive: true })
    if (stat.isSymbolicLink()) {
      try { fs.symlinkSync(fs.readlinkSync(sourceFile), targetFile) } catch { fs.copyFileSync(sourceFile, targetFile) }
    } else if (stat.isFile()) {
      fs.copyFileSync(sourceFile, targetFile)
    }
  }
}

function launchWindowsTerminal(worktreePath: string, branch: string): boolean {
  try {
    const child = spawn("wt.exe", ["new-tab", "--title", branch, "--startingDirectory", worktreePath, "opencode", worktreePath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, OPENCODE_WORKTREE_AUTO: "0" },
    })
    child.unref()
    return true
  } catch {
    return false
  }
}

function commandAvailable(command: string): boolean {
  if (process.platform !== "win32") return false
  const probe = process.platform === "win32"
    ? run("where.exe", [command], { timeout: 3000, env: { ...process.env, MSYS2_ARG_CONV_EXCL: "*" } })
    : run("command", ["-v", command], { timeout: 3000 })
  return probe.status === 0
}

function cleanupCreated(repo: string, created: CreatedWorktree[]): void {
  for (const item of created.slice().reverse()) {
    run("git", ["-C", repo, "worktree", "remove", "--force", item.path], { timeout: 30000 })
    run("git", ["-C", repo, "branch", "-D", item.branch], { timeout: 30000 })
  }
}

function quoteArg(value: string): string {
  return /[\s"]/g.test(value) ? JSON.stringify(value) : value
}

function commandOutput(value: unknown): string {
  if (!value) return ""
  if (Buffer.isBuffer(value)) return value.toString("utf8").trim()
  return String(value).trim()
}
