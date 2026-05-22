#!/usr/bin/env node
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { git, gitOutput, isMainModule, needValue, safeRmTree, UsageError } from "./core/lib/exec.ts"

const USAGE = [
  "install.ts - install worktree isolation into a target git repo.",
  "",
  "Usage:",
  "  node install.ts [--target <repo-dir>] [--prefix <dir>] [--with-opencode-permissions] [--with-opencode-os-sandbox]",
].join("\n")

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))

type InstallOptions = {
  target: string
  prefix: string
  withOpenCodePermissions: boolean
  withOpenCodeOsSandbox: boolean
}

export function install(argv: string[]): number {
  const options = parseArgs(argv)
  if (git(["rev-parse", "--is-inside-work-tree"], options.target).status !== 0) {
    console.error(`not a git repo: ${options.target}`)
    return 1
  }

  const installRoot = path.join(options.target, options.prefix, "worktree")
  fs.mkdirSync(path.join(installRoot, "core", "lib"), { recursive: true })
  fs.mkdirSync(path.join(installRoot, "core", "cmd"), { recursive: true })
  ensureGitignore(options.target, options.prefix)

  console.log(`[install] copying core to ${path.join(installRoot, "core")}`)
  syncDir(path.join(SCRIPT_DIR, "core", "lib"), path.join(installRoot, "core", "lib"), [".ts"], [".sh", ".js"])
  syncDir(path.join(SCRIPT_DIR, "core", "cmd"), path.join(installRoot, "core", "cmd"), [".ts"], [".sh", ".js"])
  safeRmTree(path.join(installRoot, "adapter"))
  removeNonOpenCodeAdapters(path.join(installRoot, "adapters"))

  const gitCommon = absoluteGitCommonDir(options.target)
  const preMergeHook = path.join(gitCommon, "hooks", "pre-merge-commit")
  console.log(`[install] writing pre-merge-commit hook at ${preMergeHook}`)
  writeExecutable(preMergeHook, preMergeHookSource(options.prefix))

  const postMergeHook = path.join(gitCommon, "hooks", "post-merge")
  console.log(`[install] writing post-merge hook at ${postMergeHook}`)
  writeExecutable(postMergeHook, postMergeHookSource(options.prefix))

  const adapterDir = path.join(installRoot, "adapters", "opencode")
  fs.mkdirSync(path.join(adapterDir, "plugins"), { recursive: true })
  fs.mkdirSync(path.join(adapterDir, "tui"), { recursive: true })
  safeRmTree(path.join(adapterDir, "bin"))
  safeRmTree(path.join(adapterDir, "lib"))
  console.log(`[install] copying OpenCode adapter to ${adapterDir}`)
  syncDir(path.join(SCRIPT_DIR, "adapters", "opencode", "plugins"), path.join(adapterDir, "plugins"), [".ts"], [".js"])
  syncDir(path.join(SCRIPT_DIR, "adapters", "opencode", "tui"), path.join(adapterDir, "tui"), [".ts", ".tsx"], [".js"])

  const projectPluginDir = path.join(options.target, ".opencode", "plugins")
  fs.mkdirSync(projectPluginDir, { recursive: true })
  console.log(`[install] writing OpenCode plugin to ${path.join(projectPluginDir, "worktree-sandbox.ts")}`)
  fs.rmSync(path.join(projectPluginDir, "worktree-sandbox.js"), { force: true })
  fs.copyFileSync(path.join(SCRIPT_DIR, "adapters", "opencode", "plugins", "worktree-sandbox.ts"), path.join(projectPluginDir, "worktree-sandbox.ts"))

  const tuiConfig = path.join(options.target, ".opencode", "tui.json")
  const tuiPluginDir = path.join(options.target, ".opencode", "tui-plugins")
  console.log(`[install] writing OpenCode TUI plugin to ${tuiPluginDir}`)
  fs.mkdirSync(tuiPluginDir, { recursive: true })
  for (const stale of ["worktree-sandbox-branch-core.js", "worktree-sandbox-branch-core.ts", "worktree-sandbox-branch.tsx"]) {
    fs.rmSync(path.join(tuiPluginDir, stale), { force: true })
  }
  copyMatching(path.join(SCRIPT_DIR, "adapters", "opencode", "tui"), tuiPluginDir, [".ts", ".tsx"])
  console.log(`[install] adding OpenCode TUI branch plugin to ${tuiConfig}`)
  mergePluginConfig(tuiConfig, "https://opencode.ai/tui.json", "./tui-plugins/worktree-sandbox-branch.tsx")

  if (options.withOpenCodePermissions) {
    const cfg = path.join(options.target, "opencode.json")
    console.log(`[install] adding conservative OpenCode permissions to ${cfg}`)
    mergeOpenCodePermissions(cfg)
  }

  if (options.withOpenCodeOsSandbox) {
    const cfg = path.join(options.target, "opencode.json")
    console.log(`[install] adding opencode-sandbox plugin to ${cfg}`)
    mergePluginConfig(cfg, "https://opencode.ai/config.json", "opencode-sandbox")
  }

  console.log("[install] done.")
  console.log(`  core installed at: ${path.join(installRoot, "core")}`)
  console.log(`  pre-merge-commit hook: ${preMergeHook}`)
  console.log(`  post-merge hook: ${postMergeHook}`)
  console.log(`  opencode adapter: ${adapterDir}`)
  if (options.withOpenCodePermissions) console.log(`  opencode permissions: ${path.join(options.target, "opencode.json")}`)
  if (options.withOpenCodeOsSandbox) console.log(`  opencode OS sandbox plugin: ${path.join(options.target, "opencode.json")}`)
  return 0
}

function parseArgs(argv: string[]): InstallOptions {
  const options: InstallOptions = {
    target: process.cwd(),
    prefix: ".opencode",
    withOpenCodePermissions: false,
    withOpenCodeOsSandbox: false,
  }
  for (let i = 0; i < argv.length;) {
    const arg = argv[i]
    switch (arg) {
      case "--target": options.target = path.resolve(needValue(argv, i, USAGE)); i += 2; break
      case "--prefix": options.prefix = needValue(argv, i, USAGE); i += 2; break
      case "--with-opencode-permissions": options.withOpenCodePermissions = true; i += 1; break
      case "--with-opencode-os-sandbox": options.withOpenCodeOsSandbox = true; i += 1; break
      case "-h":
      case "--help": throw new UsageError(USAGE)
      default:
        console.error(`unknown arg: ${arg}`)
        throw new UsageError(USAGE)
    }
  }
  return options
}

function ensureGitignore(target: string, prefix: string): void {
  const file = path.join(target, ".gitignore")
  const pattern = `/${prefix}/worktree/worktrees/`
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
  if (current.split(/\r?\n/).includes(pattern)) return
  fs.appendFileSync(file, `\n# OpenCode worktrees - generated by worktree install.ts\n${pattern}\n`, "utf8")
  console.log(`[install] added ${pattern} to ${file}`)
}

function syncDir(source: string, dest: string, includeExts: string[], staleExts: string[]): void {
  if (!fs.existsSync(source)) throw new Error(`install: missing source directory ${source}`)
  fs.mkdirSync(dest, { recursive: true })
  const files = fs.readdirSync(source).filter((name) => includeExts.includes(path.extname(name)))
  if (files.length === 0) throw new Error(`install: no ${includeExts.join("/")} files in ${source}`)
  for (const name of fs.readdirSync(dest)) {
    if (includeExts.includes(path.extname(name)) || staleExts.includes(path.extname(name))) fs.rmSync(path.join(dest, name), { force: true })
  }
  for (const name of files) copyFileExecutable(path.join(source, name), path.join(dest, name))
}

function copyMatching(source: string, dest: string, exts: string[]): void {
  const files = fs.readdirSync(source).filter((name) => exts.includes(path.extname(name)))
  if (files.length === 0) throw new Error(`install: no ${exts.join("/")} files in ${source}`)
  for (const name of files) fs.copyFileSync(path.join(source, name), path.join(dest, name))
}

function copyFileExecutable(source: string, dest: string): void {
  fs.copyFileSync(source, dest)
  try { fs.chmodSync(dest, 0o755) } catch { /* Windows may ignore chmod */ }
}

function writeExecutable(file: string, source: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, source, "utf8")
  try { fs.chmodSync(file, 0o755) } catch { /* Windows may ignore chmod */ }
}

function removeNonOpenCodeAdapters(adaptersDir: string): void {
  if (!fs.existsSync(adaptersDir)) return
  for (const name of fs.readdirSync(adaptersDir)) {
    if (name !== "opencode") safeRmTree(path.join(adaptersDir, name))
  }
}

function absoluteGitCommonDir(target: string): string {
  const common = gitOutput(["rev-parse", "--git-common-dir"], target)
  return path.isAbsolute(common) || /^[A-Za-z]:[\\/]/.test(common) ? path.resolve(common) : path.resolve(target, common)
}

function readJsonObject(file: string, schema: string): any {
  if (!fs.existsSync(file)) return { $schema: schema }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"))
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`opencode config must be a JSON object: ${file}`)
  return parsed
}

function writeJson(file: string, value: any): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function mergePluginConfig(file: string, schema: string, plugin: string): void {
  const cfg = readJsonObject(file, schema)
  const current = cfg.plugin
  if (current === undefined) cfg.plugin = [plugin]
  else if (Array.isArray(current)) {
    if (!current.includes(plugin)) current.push(plugin)
  } else if (typeof current === "string") cfg.plugin = current === plugin ? [plugin] : [current, plugin]
  else throw new Error(`opencode config 'plugin' must be an array or string: ${file}`)
  writeJson(file, cfg)
}

function mergeOpenCodePermissions(file: string): void {
  const cfg = readJsonObject(file, "https://opencode.ai/config.json")
  if (cfg.permission === undefined) cfg.permission = {}
  if (!cfg.permission || typeof cfg.permission !== "object" || Array.isArray(cfg.permission)) throw new Error(`opencode config 'permission' must be an object: ${file}`)
  const permission = cfg.permission
  permission.external_directory ??= "ask"
  permission.doom_loop ??= "ask"
  if (permission.read === undefined) permission.read = { "*": "allow" }
  if (permission.read && typeof permission.read === "object" && !Array.isArray(permission.read)) {
    permission.read["*.env"] ??= "deny"
    permission.read["*.env.*"] ??= "deny"
    permission.read["*.env.example"] ??= "allow"
  }
  if (permission.bash === undefined) permission.bash = {}
  if (permission.bash && typeof permission.bash === "object" && !Array.isArray(permission.bash)) {
    permission.bash["git reset --hard*"] ??= "deny"
    permission.bash["git push --force*"] ??= "deny"
    permission.bash["git push -f*"] ??= "deny"
    permission.bash["rm -rf *"] ??= "deny"
    permission.bash["rm -fr *"] ??= "deny"
  }
  writeJson(file, cfg)
}

function preMergeHookSource(prefix: string): string {
  return `#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import path from "node:path"
const repo = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" })
if (repo.status !== 0) process.exit(0)
const repoRoot = repo.stdout.trim()
const gate = path.join(repoRoot, ${JSON.stringify(prefix)}, "worktree", "core", "cmd", "sandbox-merge-gate.ts")
const mergeShas = Object.keys(process.env).filter((name) => name.startsWith("GITHEAD_")).map((name) => name.slice("GITHEAD_".length))
if (mergeShas.length === 0) process.exit(0)
delete process.env.GIT_INDEX_FILE
delete process.env.GIT_DIR
delete process.env.GIT_WORK_TREE
delete process.env.GIT_PREFIX
const list = spawnSync("git", ["worktree", "list", "--porcelain"], { encoding: "utf8", cwd: repoRoot })
if (list.status !== 0) process.exit(0)
let current = ""
let sandbox = ""
for (const line of list.stdout.split(/\\r?\\n/)) {
  if (line.startsWith("worktree ")) current = line.slice("worktree ".length)
  if (line.startsWith("HEAD ") && mergeShas.includes(line.slice("HEAD ".length)) && current && path.resolve(current) !== path.resolve(repoRoot)) {
    sandbox = current
    break
  }
}
if (!sandbox) process.exit(0)
const result = spawnSync(process.execPath, [gate, "--worktree", sandbox], { encoding: "utf8", cwd: repoRoot })
if (result.status !== 0) {
  process.stderr.write(result.stdout || result.stderr || "sandbox merge gate failed\n")
  process.exit(1)
}
process.exit(0)
`
}

function postMergeHookSource(prefix: string): string {
  return `#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
const repo = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" })
if (repo.status !== 0) process.exit(0)
const repoRoot = repo.stdout.trim()
const installer = path.join(repoRoot, "install.ts")
if (!fs.existsSync(installer)) process.exit(0)
const args = [installer, "--target", repoRoot, "--prefix", ${JSON.stringify(prefix)}]
try {
  const cfgPath = path.join(repoRoot, "opencode.json")
  const cfg = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, "utf8") : ""
  if (cfg.includes('"external_directory": "ask"') && cfg.includes('"doom_loop": "ask"')) args.push("--with-opencode-permissions")
  if (cfg.includes('"opencode-sandbox"')) args.push("--with-opencode-os-sandbox")
} catch {}
const child = spawn(process.execPath, args, { cwd: path.parse(repoRoot).root, detached: true, stdio: "ignore", windowsHide: true })
child.unref()
process.exit(0)
`
}

if (isMainModule(import.meta.url)) {
  try {
    process.exit(install(process.argv.slice(2)))
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message)
      process.exit(error.status)
    }
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
