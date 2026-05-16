import fs from "node:fs"
import path from "node:path"

export function cleanupLog(root: string, action = "?", session = "-", branch = "-", reason = "-", extra = ""): void {
  if (!root) return
  try {
    const dir = path.join(root, "logs")
    fs.mkdirSync(dir, { recursive: true })
    const now = new Date()
    const day = now.toISOString().slice(0, 10)
    const ts = now.toISOString().replace(/\.\d{3}Z$/, "Z")
    const line = extra ? `${ts} ${action} session=${session} branch=${branch} reason=${reason} ${extra}` : `${ts} ${action} session=${session} branch=${branch} reason=${reason}`
    fs.appendFileSync(path.join(dir, `cleanup-${day}.log`), `${line}\n`, "utf8")
  } catch {
    // diagnostics must never block cleanup
  }
}
