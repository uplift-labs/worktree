import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export type RunResult = {
  status: number
  stdout: string
  stderr: string
  error?: Error
}

export function run(command: string, args: string[] = [], options: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv } = {}): RunResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: options.timeout,
    windowsHide: true,
  })
  return {
    status: typeof result.status === "number" ? result.status : 1,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    error: result.error,
  }
}

export function git(args: string[], cwd: string, options: { timeout?: number; env?: NodeJS.ProcessEnv } = {}): RunResult {
  return run("git", ["-C", cwd, ...args], options)
}

export function gitOutput(args: string[], cwd: string, options: { timeout?: number; env?: NodeJS.ProcessEnv } = {}): string {
  const result = git(args, cwd, options)
  if (result.status !== 0) {
    const error = new Error(result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`)
    ;(error as any).stdout = result.stdout
    ;(error as any).stderr = result.stderr
    ;(error as any).status = result.status
    throw error
  }
  return result.stdout.trim()
}

export function gitOk(args: string[], cwd: string): boolean {
  return git(args, cwd).status === 0
}

export function isWindowsAbsolute(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value || "")
}

export function resolveMaybeAbsolute(value: string, base = process.cwd()): string {
  if (!value) return ""
  return path.isAbsolute(value) || isWindowsAbsolute(value) ? path.resolve(value) : path.resolve(base, value)
}

export function toPosix(value: string): string {
  return String(value || "").replace(/\\/g, "/")
}

export function normalizeForCompare(value: string): string {
  const resolved = toPosix(path.resolve(value))
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

export function isWithinPath(child: string, parent: string): boolean {
  if (!child || !parent) return false
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel))
}

export function currentEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

export function safeRm(file: string): void {
  try {
    fs.rmSync(file, { force: true, recursive: false })
  } catch {
    // best-effort cleanup
  }
}

export function safeRmTree(file: string): void {
  try {
    fs.rmSync(file, { force: true, recursive: true })
  } catch {
    // best-effort cleanup
  }
}

export function isMainModule(metaUrl: string): boolean {
  const current = fileURLToPath(metaUrl)
  return path.resolve(process.argv[1] || "") === path.resolve(current)
}

export class UsageError extends Error {
  status = 2
}

export function needValue(args: string[], index: number, usage: string): string {
  const value = args[index + 1]
  if (!value) throw new UsageError(usage)
  return value
}

export function failOpen<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}
