#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { isMainModule, needValue, run, UsageError } from "./exec.ts"
import { cleanupLog } from "./cleanup-log.ts"

const USAGE = "usage: heartbeat.ts --marker <marker-path> [--pid <pid>] [--interval <seconds>] [--max-age <seconds>] [--parent-winpid <windows-pid>] [--repo <dir>] [--worktree-root <dir>] [--worktrees-dir <rel>] [--branch-prefix <glob>] [--owner-process-names <name[,name...]>]"

export async function heartbeat(argv: string[]): Promise<number> {
  let pid = ""
  let marker = ""
  let interval = 1
  let maxAge = 86400
  let parentWinPid = ""
  let repo = ""
  let worktreeRoot = ""
  let worktreesDir = ".worktree/worktrees"
  let branchPrefix = "wt-*"
  let ownerProcessNames = "opencode,opencode.exe,node,node.exe,bun,bun.exe"

  for (let i = 0; i < argv.length;) {
    const arg = argv[i]
    switch (arg) {
      case "--pid": pid = needValue(argv, i, USAGE); i += 2; break
      case "--marker": marker = needValue(argv, i, USAGE); i += 2; break
      case "--interval": interval = Number.parseInt(needValue(argv, i, USAGE), 10); i += 2; break
      case "--max-age": maxAge = Number.parseInt(needValue(argv, i, USAGE), 10); i += 2; break
      case "--parent-winpid": parentWinPid = needValue(argv, i, USAGE); i += 2; break
      case "--repo": repo = needValue(argv, i, USAGE); i += 2; break
      case "--worktree-root": worktreeRoot = needValue(argv, i, USAGE); i += 2; break
      case "--worktrees-dir": worktreesDir = needValue(argv, i, USAGE); i += 2; break
      case "--branch-prefix": branchPrefix = needValue(argv, i, USAGE); i += 2; break
      case "--owner-process-names": ownerProcessNames = needValue(argv, i, USAGE); i += 2; break
      default: i += 1; break
    }
  }
  if (!marker) return 1

  let parentDied = false
  let cleanupRan = false
  const sidecar = `${marker}.hb`
  const monitoredPid = pid && pid !== "0" ? Number(pid) : 0
  const checkWinPid = parentWinPid && parentWinPid !== "0"
  let tick = 0

  const cleanup = () => {
    if (parentDied && !cleanupRan) return
    try { fs.rmSync(sidecar, { force: true }) } catch { /* best effort */ }
  }
  process.on("exit", cleanup)
  process.on("SIGINT", () => { process.exit(0) })
  process.on("SIGTERM", () => { process.exit(0) })
  process.on("SIGHUP", () => { parentDied = true })

  try {
    fs.writeFileSync(sidecar, `${process.pid} ${parentWinPid || 0} ${monitoredPid || 0}`, "utf8")
  } catch {
    return 1
  }

  const started = Math.floor(Date.now() / 1000)
  while (true) {
    if (parentDied) break
    if (!fs.existsSync(marker)) break
    if (monitoredPid && !isPidAlive(monitoredPid)) { parentDied = true; break }
    if (checkWinPid && tick % 5 === 0 && !winPidAlive(parentWinPid)) { parentDied = true; break }
    if (Math.floor(Date.now() / 1000) - started >= maxAge) break
    try {
      const now = new Date()
      fs.utimesSync(marker, now, now)
    } catch {
      // lifecycle TTL remains
    }
    await sleep(Math.max(1, interval) * 1000)
    tick += 1
  }

  if (parentDied && worktreeRoot && repo) {
    const session = path.basename(marker)
    if (process.platform === "win32" && hasLiveOwnerProcess(ownerProcessNames)) {
      cleanupLog(worktreeRoot, "SKIP", session, "-", "heartbeat-sanity-live-owner")
      try { fs.rmSync(sidecar, { force: true }) } catch { /* best effort */ }
      cleanupRan = true
      return 0
    }
    cleanupLog(worktreeRoot, "DESTROY", session, "-", "heartbeat-parent-death")
    try {
      const child = spawn(process.execPath, [path.join(worktreeRoot, "core", "cmd", "worktree-cleanup.ts"), "--repo", repo, "--session", session, "--worktrees-dir", worktreesDir, "--branch-prefix", branchPrefix], {
        cwd: worktreeRoot,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      })
      child.unref()
      cleanupRan = true
    } catch {
      // sidecar remains as dead-PID signal for lifecycle
    }
  }
  return 0
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

function winPidAlive(pid: string): boolean {
  const result = run("wmic", ["process", "where", `ProcessId=${pid}`, "get", "ProcessId", "/format:value"])
  return result.status === 0 && result.stdout.includes("ProcessId")
}

function hasLiveOwnerProcess(names: string): boolean {
  for (const rawName of names.split(",")) {
    const name = rawName.trim()
    if (!name) continue
    const result = run("tasklist", ["/FI", `IMAGENAME eq ${name}`, "/NH"], { env: { ...process.env, MSYS2_ARG_CONV_EXCL: "*" } })
    if (result.status === 0 && result.stdout.toLowerCase().includes(name.toLowerCase())) return true
  }
  return false
}

if (isMainModule(import.meta.url)) {
  try {
    process.exit(await heartbeat(process.argv.slice(2)))
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message)
      process.exit(error.status)
    }
    process.exit(1)
  }
}
