import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export type CommandResult = { status: number; stdout: string; stderr: string }

export function run(command: string, args: string[], cwd = projectRoot): CommandResult {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true })
  return {
    status: typeof result.status === "number" ? result.status : 1,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
  }
}

export function nodeScript(relative: string, args: string[] = [], cwd = projectRoot): CommandResult {
  return run(process.execPath, [path.join(projectRoot, relative), ...args], cwd)
}

export function git(cwd: string, args: string[]): CommandResult {
  return run("git", args, cwd)
}

export function tempDir(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `worktree-${name}-`))
}

export function initRepo(name: string): string {
  const repo = path.join(tempDir(name), "repo")
  fs.mkdirSync(repo, { recursive: true })
  let init = git(repo, ["init", "-b", "main"])
  if (init.status !== 0) {
    init = git(repo, ["init"])
    if (init.status !== 0) throw new Error(init.stderr || init.stdout)
    git(repo, ["checkout", "-b", "main"])
  }
  git(repo, ["config", "user.email", "test@example.com"])
  git(repo, ["config", "user.name", "Test User"])
  fs.writeFileSync(path.join(repo, "README.md"), "# test\n", "utf8")
  git(repo, ["add", "README.md"])
  const commit = git(repo, ["commit", "-m", "init"])
  if (commit.status !== 0) throw new Error(commit.stderr || commit.stdout)
  return repo
}

export function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, "utf8"))
}
