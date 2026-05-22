import fs from "node:fs"
import path from "node:path"
import { currentEpoch, safeRm } from "./exec.ts"

export function markerSafeId(value: string): string {
  return String(value || "").replace(/[^a-zA-Z0-9-]/g, "-")
}

export function markerPath(common: string, session: string): string {
  const safe = markerSafeId(session)
  if (!safe) throw new Error("empty marker session")
  const safePath = path.join(common, "worktree-markers", safe)
  if (!/[\\/]/.test(session) && session !== "." && session !== "..") {
    const legacyPath = path.join(common, "worktree-markers", session)
    if (legacyPath !== safePath && fs.existsSync(legacyPath)) return legacyPath
  }
  return safePath
}

export function markerWrite(file: string, value: string, initialHead = ""): boolean {
  const tmp = `${file}.tmp.${process.pid}`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const fields = initialHead ? `${value} ${currentEpoch()} ${initialHead}` : `${value} ${currentEpoch()}`
    fs.writeFileSync(tmp, fields, "utf8")
    fs.renameSync(tmp, file)
    return true
  } catch {
    safeRm(tmp)
    return false
  }
}

function fields(file: string): string[] {
  if (!fs.existsSync(file)) return []
  try {
    return fs.readFileSync(file, "utf8").trim().split(/\s+/)
  } catch {
    return []
  }
}

export function markerReadValue(file: string): string {
  return fields(file)[0] || ""
}

export function markerReadEpoch(file: string): string {
  return fields(file)[1] || ""
}

export function markerReadInitialHead(file: string): string {
  return fields(file)[2] || ""
}

export function markerTouch(file: string): void {
  if (!fs.existsSync(file)) return
  const now = new Date()
  try {
    fs.utimesSync(file, now, now)
  } catch {
    // heartbeat/lifecycle TTL covers missed touches
  }
}

export function markerIsFresh(file: string, ttlSeconds: number): boolean {
  if (!fs.existsSync(file)) return false
  try {
    const mtime = Math.floor(fs.statSync(file).mtimeMs / 1000)
    return currentEpoch() - mtime < ttlSeconds
  } catch {
    return false
  }
}
