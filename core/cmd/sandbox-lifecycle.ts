#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { git, isMainModule, needValue, run, safeRm, UsageError } from "../lib/exec.ts"
import { cleanupLog } from "../lib/cleanup-log.ts"
import { gitCommonDir, gitRoot, hasInProgressOperation, listWorktrees, mainBranch as resolveMainBranch } from "../lib/git-context.ts"
import { markerIsFresh, markerReadEpoch, markerReadInitialHead, markerReadValue } from "../lib/ttl-marker.ts"
import { scanUncommitted } from "../lib/scan-uncommitted.ts"
import { pruneWorktreeMetadata, removeIfMerged, sweepOrphanBranches, sweepResidualDirs } from "../lib/wt-cleanup.ts"
import { reflectionRescue } from "./reflection-rescue.ts"

const USAGE = "usage: sandbox-lifecycle.ts --repo <dir> [--ttl <seconds>] [--branch-prefix <glob>] [--worktrees-dir <rel>]"
const ORPHAN_HB_GRACE = 7200
const FRESH_SESSION_TTL = 300
const SANDBOX_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

export function sandboxLifecycle(argv: string[], options: { quiet?: boolean } = {}): number {
  let repo = ""
  let ttl = 5
  let branchPrefix = "wt-*"
  let worktreesDir = ".sandbox/worktrees"

  for (let i = 0; i < argv.length;) {
    const arg = argv[i]
    switch (arg) {
      case "--repo": repo = needValue(argv, i, USAGE); i += 2; break
      case "--ttl": ttl = Number.parseInt(needValue(argv, i, USAGE), 10); i += 2; break
      case "--branch-prefix": branchPrefix = needValue(argv, i, USAGE); i += 2; break
      case "--worktrees-dir": worktreesDir = needValue(argv, i, USAGE); i += 2; break
      case "-h":
      case "--help": throw new UsageError(USAGE)
      default:
        console.error(`unknown arg: ${arg}`)
        throw new UsageError(USAGE)
    }
  }
  if (!repo) throw new UsageError(USAGE)

  let root = ""
  let common = ""
  try {
    root = gitRoot(repo)
    common = gitCommonDir(root)
  } catch {
    return 0
  }
  const mainBranch = resolveMainBranch(root)
  const markersDir = path.join(common, "sandbox-markers")
  let removed = 0
  const lines: string[] = []

  const rescueLines = captureStdout(() => reflectionRescue(["--repo", root, "--worktrees-dir", worktreesDir]))
  if (rescueLines.trim()) lines.push(rescueLines.trim())

  pruneWorktreeMetadata(root)

  if (fs.existsSync(markersDir)) {
    for (const marker of markerFiles(markersDir)) {
      let branch = markerReadValue(marker)
      if (branch) {
        const worktree = path.join(root, worktreesDir, branch)
        if (!fs.existsSync(worktree)) {
          killHeartbeatPid(marker)
          safeRm(marker)
          safeRm(`${marker}.hb`)
          cleanupLog(SANDBOX_ROOT, "PRUNE", path.basename(marker), branch, "lifecycle-phase2-orphan-marker")
          continue
        }
      }

      if (killDeadHeartbeat(marker) === 0) continue

      const created = Number.parseInt(markerReadEpoch(marker), 10)
      const now = Math.floor(Date.now() / 1000)
      if (Number.isFinite(created) && now - created < 30) continue

      let effectiveTtl = ttl
      if (branch) {
        const worktree = path.join(root, worktreesDir, branch)
        const initHead = markerReadInitialHead(marker)
        if (!initHead) {
          effectiveTtl = FRESH_SESSION_TTL
          lines.push(`WARN malformed/legacy marker: ${path.basename(marker)}`)
        } else if (fs.existsSync(worktree)) {
          const curHead = git(["rev-parse", "HEAD"], worktree).stdout.trim()
          if (curHead === initHead) effectiveTtl = FRESH_SESSION_TTL
        }
      }

      if (!markerIsFresh(marker, effectiveTtl)) {
        safeRm(marker)
        safeRm(`${marker}.hb`)
        cleanupLog(SANDBOX_ROOT, "PRUNE", path.basename(marker), branch || "-", `lifecycle-phase2-ttl-reclaim ttl=${effectiveTtl}`)
      }
    }
  }

  if (fs.existsSync(markersDir) && mainBranch) {
    for (const marker of markerFiles(markersDir)) {
      const hbRc = killDeadHeartbeat(marker)
      if (hbRc === 0) continue
      const branch = markerReadValue(marker)
      if (!branch) continue
      const worktree = path.join(root, worktreesDir, branch)
      if (!fs.existsSync(worktree)) continue
      const initHead = markerReadInitialHead(marker)
      if (!initHead) continue
      const curHead = git(["rev-parse", "HEAD"], worktree).stdout.trim()
      if (curHead === initHead && hbRc !== 2) continue
      if (hasInProgressOperation(worktree)) continue
      if (git(["symbolic-ref", "-q", "HEAD"], worktree).status !== 0) continue
      if (git(["merge-base", "--is-ancestor", branch, mainBranch], worktree).status === 0 && scanUncommitted(worktree, { ignoreDeletions: true }).clean) {
        safeRm(marker)
        safeRm(`${marker}.hb`)
        cleanupLog(SANDBOX_ROOT, "RELEASE", path.basename(marker), branch, "lifecycle-phase3-proactive-release")
      }
    }
  }

  const protectedBranches = new Set<string>()
  if (fs.existsSync(markersDir)) {
    for (const marker of markerFiles(markersDir)) {
      const branch = markerReadValue(marker)
      if (branch) protectedBranches.add(branch)
    }
  }

  let preservedBranches = ""
  for (const worktree of listWorktrees(root)) {
    if (path.resolve(worktree.path) === path.resolve(root)) continue
    if (worktree.branch === mainBranch) continue
    if (protectedBranches.has(worktree.branch)) continue
    const status = removeIfMerged(root, worktree.path, worktree.branch, mainBranch, "stale")
    if (status.removed) {
      removed += 1
      lines.push(status.line)
      cleanupLog(SANDBOX_ROOT, "DESTROY", "-", worktree.branch, "lifecycle-phase4-wt-remove")
    } else if (status.preserved) {
      lines.push(status.line)
      preservedBranches += ` ${worktree.branch} `
      cleanupLog(SANDBOX_ROOT, "PRESERVE", "-", worktree.branch, "lifecycle-phase4-preserve")
    }
  }

  lines.push(...sweepOrphanBranches(root, branchPrefix, mainBranch, preservedBranches))
  lines.push(...sweepResidualDirs(path.join(root, worktreesDir)))

  const printable = lines.filter(Boolean)
  if (!options.quiet && printable.length > 0) {
    console.log(`sandbox-lifecycle: cleaned=${removed}`)
    console.log(printable.join("\n"))
  }
  return 0
}

function markerFiles(markersDir: string): string[] {
  return fs.readdirSync(markersDir)
    .filter((name) => !name.endsWith(".hb"))
    .map((name) => path.join(markersDir, name))
    .filter((file) => fs.existsSync(file) && fs.statSync(file).isFile())
}

function captureStdout(fn: () => void): string {
  const original = console.log
  const lines: string[] = []
  console.log = (...args: any[]) => { lines.push(args.join(" ")) }
  try { fn() } finally { console.log = original }
  return lines.join("\n")
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function heartbeatFields(sidecar: string): string[] {
  try { return fs.readFileSync(sidecar, "utf8").trim().split(/\s+/) } catch { return [] }
}

function tasklistHasPid(pid: string): boolean | null {
  const result = run("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], { env: { ...process.env, MSYS2_ARG_CONV_EXCL: "*" } })
  if (result.error) return null
  return result.stdout.includes(pid)
}

function hbIsSessionAlive(sidecar: string, marker: string): boolean {
  const fields = heartbeatFields(sidecar)
  if (fields.length < 2) return false
  const parentWinPid = fields[1] || "0"
  const monitoredPid = fields[2] || "0"
  if (monitoredPid !== "0" && monitoredPid) return isPidAlive(Number(monitoredPid))
  if (parentWinPid !== "0" && parentWinPid) {
    const live = tasklistHasPid(parentWinPid)
    return live === null ? true : live
  }
  const created = Number.parseInt(markerReadEpoch(marker), 10)
  const now = Math.floor(Date.now() / 1000)
  return Number.isFinite(created) ? now - created < ORPHAN_HB_GRACE : true
}

function hbHasLiveOwner(sidecar: string): boolean {
  const fields = heartbeatFields(sidecar)
  if (fields.length < 2) return false
  const parentWinPid = fields[1] || "0"
  const monitoredPid = fields[2] || "0"
  if (monitoredPid !== "0" && monitoredPid) return isPidAlive(Number(monitoredPid))
  if (parentWinPid !== "0" && parentWinPid) {
    const live = tasklistHasPid(parentWinPid)
    return live === null ? true : live
  }
  return false
}

function killHeartbeatPid(marker: string): void {
  const pid = Number(heartbeatFields(`${marker}.hb`)[0] || 0)
  if (pid > 0) {
    try { process.kill(pid) } catch { /* already gone */ }
  }
}

function killDeadHeartbeat(marker: string): number {
  const sidecar = `${marker}.hb`
  if (!fs.existsSync(sidecar)) return 1
  const pid = Number(heartbeatFields(sidecar)[0] || 0)
  if (isPidAlive(pid)) {
    if (hbIsSessionAlive(sidecar, marker)) return 0
    try { process.kill(pid) } catch { /* already gone */ }
    safeRm(sidecar)
  }
  if (hbHasLiveOwner(sidecar)) return 0
  return 2
}

if (isMainModule(import.meta.url)) {
  try {
    process.exit(sandboxLifecycle(process.argv.slice(2)))
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message)
      process.exit(error.status)
    }
    process.exit(0)
  }
}
