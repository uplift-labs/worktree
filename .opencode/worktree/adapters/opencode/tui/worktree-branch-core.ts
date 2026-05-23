import { execFile, execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>
type WorktreeResolveInput = {
  env?: Env
  directory?: string
  worktreeHint?: string
  worktree?: string
  sessionID?: string
  baseRef?: string
}
type ChangedFile = { file: string; additions: number; deletions: number }
type BuiltinFilesOptions = {
  onSettled?: (status: { hidden: boolean }) => void
  onError?: (error: unknown, phase: string) => void
}
type BranchObserverOptions = WorktreeResolveInput & {
  debounceMs?: number | string
  getWorktree?: () => string | Promise<string>
  onChange?: (next: { branch: string; worktree: string; reason: string }) => void
  onError?: (error: unknown, phase: string) => void
}
type ChangedFilesObserverOptions = WorktreeResolveInput & {
  debounceMs?: number | string
  getWorktree?: () => string | Promise<string>
  onChange?: (next: { files: ChangedFile[]; worktree: string; reason: string }) => void
  onError?: (error: unknown, phase: string) => void
}
type BranchObserverState = {
  branch: string
  worktree: string
  headPath: string
  watcher?: fs.FSWatcher
  watcherActive: boolean
  closingWatcher: boolean
  pollTimer?: ReturnType<typeof setInterval>
  pollMs: number
  debounceTimer?: ReturnType<typeof setTimeout>
  refreshing: boolean
  pendingRefresh: boolean
  stopped: boolean
}
type ChangedFilesObserverState = {
  files: ChangedFile[]
  signature: string
  worktree: string
  pollTimer?: ReturnType<typeof setInterval>
  pollMs: number
  debounceTimer?: ReturnType<typeof setTimeout>
  refreshing: boolean
  pendingRefresh: boolean
  stopped: boolean
}
type TuiPluginRecord = { id: string; active?: boolean; enabled?: boolean }
type TuiApi = {
  kv?: {
    get?: (key: string, fallback?: unknown) => unknown
    set?: (key: string, value: unknown) => unknown
  }
  plugins?: {
    list?: () => TuiPluginRecord[]
    activate?: (id: string) => Promise<boolean> | boolean
    deactivate?: (id: string) => Promise<boolean> | boolean
  }
}
export type WorktreeCommandResult = {
  status: number
  stdout: string
  stderr: string
}

const DEFAULT_REFRESH_MS = 1000
const WATCH_REFRESH_MS = 5000
const DEFAULT_DEBOUNCE_MS = 100
const DEFAULT_FILES_REFRESH_MS = 2000
const DEFAULT_GIT_TIMEOUT_MS = 3000
const DEFAULT_GIT_MAX_BUFFER = 10 * 1024 * 1024
const BUILTIN_FILES_PLUGIN_ID = "internal:sidebar-files"
const TUI_PLUGIN_ID_PREFIX = "worktree.branch"
const PLUGIN_ENABLED_KV = "plugin_enabled"

const builtinFilesState = {
  refs: 0,
  hidden: false,
  previousEnabled: undefined as Record<string, boolean> | undefined,
  task: Promise.resolve(),
}

function commandOutput(value: unknown): string {
  if (!value) return ""
  if (Buffer.isBuffer(value)) return value.toString("utf8")
  return String(value)
}

function envValue(env: Env | undefined, name: string): string {
  return env?.[name] || ""
}

function gitOutput(args: string[], cwd: string): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
}

function gitTimeoutMs(env: Env = process.env): number {
  return parsePositiveInt(envValue(env, "AISB_OPENCODE_GIT_TIMEOUT_MS"), DEFAULT_GIT_TIMEOUT_MS)
}

function gitOutputAsync(args: string[], cwd: string, env: Env = process.env): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      {
        encoding: "utf8",
        maxBuffer: DEFAULT_GIT_MAX_BUFFER,
        timeout: gitTimeoutMs(env),
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        resolve(String(stdout || "").trim())
      },
    )
  })
}

async function pathExistsAsync(file: string): Promise<boolean> {
  if (!file) return false
  try {
    await fs.promises.access(file)
    return true
  } catch {
    return false
  }
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const next = Number.parseInt(String(value || ""), 10)
  return Number.isFinite(next) && next > 0 ? next : fallback
}

function parseNonNegativeInt(value: unknown, fallback: number): number {
  const next = Number.parseInt(String(value || ""), 10)
  return Number.isFinite(next) && next >= 0 ? next : fallback
}

function unrefTimer(timer?: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>): void {
  if (timer && typeof timer.unref === "function") timer.unref()
}

function defer(fn: () => void): void {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(fn)
    return
  }
  void Promise.resolve().then(fn)
}

function sanitizeOptionalId(value: unknown): string {
  const safe = String(value || "")
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
  return safe
}

function sanitizeId(value: unknown): string {
  return sanitizeOptionalId(value) || `${Date.now()}-${process.pid}`
}

function normalizePathForCompare(file: string): string {
  const resolved = path.resolve(file)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function isWithinPath(child: string, parent: string): boolean {
  if (!child || !parent) return false
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel))
}

function moduleFilePath(moduleURL: string): string {
  if (!moduleURL) return ""
  try {
    if (String(moduleURL).startsWith("file://")) return fileURLToPath(moduleURL)
    return path.resolve(String(moduleURL))
  } catch {
    return ""
  }
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function tuiPluginID(moduleURL = ""): string {
  const file = moduleFilePath(moduleURL)
  if (!file) return TUI_PLUGIN_ID_PREFIX
  return `${TUI_PLUGIN_ID_PREFIX}.${hashString(normalizePathForCompare(file))}`
}

export function nodeScriptRunner(env: Env = process.env, execPath = process.execPath): string {
  const override = envValue(env, "OPENCODE_WORKTREE_NODE") || envValue(env, "WORKTREE_NODE")
  if (override) return override
  const name = path.basename(execPath || "").toLowerCase()
  if (name === "node" || name === "node.exe" || name === "bun" || name === "bun.exe") return execPath
  return "node"
}

export async function runWorktreeCommandAsync(moduleURL: string, input: { directory?: string; args?: string } = {}): Promise<WorktreeCommandResult> {
  const directory = input.directory || process.cwd()
  const root = await findWorktreeRootAsync(moduleURL, directory)
  if (!root) return { status: 1, stdout: "", stderr: "worktree core not found" }
  const script = path.join(root, "core", "cmd", "worktree-spawn.ts")
  const args = [script, "--repo", directory, "--worktrees-dir", worktreesDirFor(root, directory), "--branch-prefix", branchPrefix(process.env), ...parseWorktreeArgs(input.args || "")]
  return execNodeAsync(args, root)
}

async function findWorktreeRootAsync(moduleURL: string, directory: string): Promise<string> {
  const candidates: string[] = []
  const envRoot = envValue(process.env, "OPENCODE_WORKTREE_ROOT")
  if (envRoot) candidates.push(envRoot)
  const repo = resolveRepo(directory)
  if (repo) candidates.push(path.join(repo, ".opencode", "worktree"), repo)
  let cur = path.dirname(moduleFilePath(moduleURL) || directory)
  for (let i = 0; i < 8; i += 1) {
    candidates.push(cur)
    const next = path.dirname(cur)
    if (next === cur) break
    cur = next
  }
  for (const candidate of candidates) {
    if (candidate && await pathExistsAsync(path.join(candidate, "core", "cmd", "worktree-spawn.ts"))) return candidate
  }
  return ""
}

function worktreesDirFor(root: string, directory: string): string {
  const envDir = envValue(process.env, "OPENCODE_WORKTREES_DIR") || envValue(process.env, "WORKTREE_WORKTREES_DIR")
  if (envDir) return envDir
  const repo = resolveRepo(directory)
  if (repo && isWithinPath(root, repo) && normalizePathForCompare(root) !== normalizePathForCompare(repo)) return `${toPosix(path.relative(repo, root))}/worktrees`
  return ".opencode/worktree/worktrees"
}

function branchPrefix(env: Env = process.env): string {
  return envValue(env, "WORKTREE_BRANCH_PREFIX") || envValue(env, "OPENCODE_WORKTREE_BRANCH_PREFIX") || "wt"
}

function parseWorktreeArgs(value: string): string[] {
  const tokens = shellWords(value)
  const args: string[] = []
  for (let i = 0; i < tokens.length;) {
    const token = tokens[i]
    if (token === "-n" || token === "--count") {
      const next = tokens[i + 1]
      if (next) args.push("-n", next)
      i += 2
      continue
    }
    if (token.startsWith("-n=") || token.startsWith("--count=")) {
      args.push("-n", token.slice(token.indexOf("=") + 1))
      i += 1
      continue
    }
    if (token === "--print" || token === "--no-dirty") args.push(token)
    i += 1
  }
  return args
}

function shellWords(value: string): string[] {
  const words: string[] = []
  let current = ""
  let quote = ""
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]
    if (quote) {
      if (char === quote) quote = ""
      else current += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) words.push(current)
      current = ""
      continue
    }
    current += char
  }
  if (current) words.push(current)
  return words
}

function execNodeAsync(args: string[], cwd: string): Promise<WorktreeCommandResult> {
  return new Promise((resolve) => {
    execFile(nodeScriptRunner(), args, {
      cwd,
      encoding: "utf8",
      maxBuffer: DEFAULT_GIT_MAX_BUFFER,
      windowsHide: true,
      env: { ...process.env, OPENCODE_WORKTREE_AUTO: "0" },
    }, (error, stdout, stderr) => {
      resolve({
        status: error && typeof (error as any).code === "number" ? (error as any).code : error ? 1 : 0,
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
      })
    })
  })
}

function toPosix(value: string): string {
  return String(value || "").replace(/\\/g, "/")
}

export function shouldRunTuiPlugin(moduleURL = "", input: WorktreeResolveInput = {}): boolean {
  const env = input.env || process.env
  const worktree = resolveWorktree({ ...input, env })
  const directory = input.directory || input.worktreeHint || process.cwd()
  if (!worktree || !directory || !isWithinPath(directory, worktree)) return true

  const modulePath = moduleFilePath(moduleURL)
  if (!modulePath || isWithinPath(modulePath, worktree)) return true

  const worktreePlugin = path.join(worktree, ".opencode", "tui-plugins", path.basename(modulePath))
  return !fs.existsSync(worktreePlugin)
}

export async function shouldRunTuiPluginAsync(moduleURL = "", input: WorktreeResolveInput = {}): Promise<boolean> {
  const env = input.env || process.env
  const worktree = await resolveWorktreeAsync({ ...input, env })
  const directory = input.directory || input.worktreeHint || process.cwd()
  if (!worktree || !directory || !isWithinPath(directory, worktree)) return true

  const modulePath = moduleFilePath(moduleURL)
  if (!modulePath || isWithinPath(modulePath, worktree)) return true

  const worktreePlugin = path.join(worktree, ".opencode", "tui-plugins", path.basename(modulePath))
  return !(await pathExistsAsync(worktreePlugin))
}

export function shouldRenderWorktreeFiles(input: WorktreeResolveInput = {}): boolean {
  const env = input.env || process.env
  const directory = input.directory || input.worktreeHint || process.cwd()

  const direct = envValue(env, "OPENCODE_WORKTREE_PATH")
  if (direct) return !!directory && !isWithinPath(directory, direct)

  if (isLikelyWorktreePath(directory, env) || isLikelyWorktreePath(input.worktreeHint, env)) return false

  const worktree = resolveWorktree({ ...input, env })
  return !!worktree && !!directory && !isWithinPath(directory, worktree)
}

export async function shouldRenderWorktreeFilesAsync(input: WorktreeResolveInput = {}): Promise<boolean> {
  return !!(await resolveRenderableWorktreeAsync(input))
}

export async function resolveRenderableWorktreeAsync(input: WorktreeResolveInput = {}): Promise<string> {
  const env = input.env || process.env
  const directory = input.directory || input.worktreeHint || process.cwd()

  const direct = envValue(env, "OPENCODE_WORKTREE_PATH")
  if (direct) {
    if (!(await pathExistsAsync(direct))) return ""
    return !!directory && !isWithinPath(directory, direct) ? path.resolve(direct) : ""
  }

  if (isLikelyWorktreePath(directory, env) || isLikelyWorktreePath(input.worktreeHint, env)) return ""

  const worktree = await resolveWorktreeAsync({ ...input, env })
  return !!worktree && !!directory && !isWithinPath(directory, worktree) ? worktree : ""
}

export function worktreeSessionID(sessionID: unknown, env: Env = process.env): string {
  return compactOpenCodeSessionID(sessionID || envValue(env, "OPENCODE_RUN_ID") || envValue(env, "OPENCODE_WORKTREE_SESSION"))
}

function compactOpenCodeSessionID(value: unknown): string {
  const safe = sanitizeOptionalId(value)
  if (!safe) return sanitizeId(value)
  if (safe.startsWith("oc-")) return safe

  const sessionMatch = safe.match(/^(?:opencode-)?ses-([a-zA-Z0-9]+)/)
  if (sessionMatch) return `oc-${sessionMatch[1].slice(0, 12)}`

  const legacy = safe.startsWith("opencode-") ? safe.slice("opencode-".length) : safe
  return `oc-${legacy.slice(0, 24)}`
}

function worktreeSessionIDCandidates(sessionID: unknown, env: Env = process.env): string[] {
  const ids: string[] = []
  const add = (value: unknown) => {
    const safe = sanitizeOptionalId(value)
    if (!safe) return
    const compact = compactOpenCodeSessionID(safe)
    const prefixed = safe.startsWith("opencode-") ? safe : `opencode-${safe}`
    for (const id of [compact, prefixed, safe]) {
      if (id && !ids.includes(id)) ids.push(id)
    }
  }

  add(sessionID)
  add(envValue(env, "OPENCODE_RUN_ID"))
  add(envValue(env, "OPENCODE_WORKTREE_SESSION"))
  return ids
}

export function branchWatchEnabled(env: Env = process.env): boolean {
  return envValue(env, "AISB_OPENCODE_BRANCH_WATCH") !== "0"
}

export function branchRefreshMs(env: Env = process.env, watcherActive = false): number {
  const fallback = watcherActive ? WATCH_REFRESH_MS : DEFAULT_REFRESH_MS
  return parsePositiveInt(envValue(env, "AISB_OPENCODE_BRANCH_REFRESH_MS"), fallback)
}

export function filesRefreshMs(env: Env = process.env): number {
  return parseNonNegativeInt(envValue(env, "AISB_OPENCODE_FILES_REFRESH_MS"), DEFAULT_FILES_REFRESH_MS)
}

export function resolveRepo(base: string): string {
  if (!base) return ""
  try {
    return gitOutput(["rev-parse", "--show-toplevel"], base)
  } catch {
    return ""
  }
}

export async function resolveRepoAsync(base: string, env: Env = process.env): Promise<string> {
  if (!base) return ""
  try {
    return await gitOutputAsync(["rev-parse", "--show-toplevel"], base, env)
  } catch {
    return ""
  }
}

export function resolveGitCommonDir(repo: string): string {
  if (!repo) return ""
  try {
    const common = gitOutput(["rev-parse", "--git-common-dir"], repo)
    if (path.isAbsolute(common) || /^[A-Za-z]:[\\/]/.test(common)) return path.resolve(common)
    return path.resolve(repo, common)
  } catch {
    return ""
  }
}

export async function resolveGitCommonDirAsync(repo: string, env: Env = process.env): Promise<string> {
  if (!repo) return ""
  try {
    const common = await gitOutputAsync(["rev-parse", "--git-common-dir"], repo, env)
    if (path.isAbsolute(common) || /^[A-Za-z]:[\\/]/.test(common)) return path.resolve(common)
    return path.resolve(repo, common)
  } catch {
    return ""
  }
}

export function resolveGitDir(worktree: string): string {
  if (!worktree) return ""
  try {
    const gitDir = gitOutput(["rev-parse", "--git-dir"], worktree)
    if (path.isAbsolute(gitDir) || /^[A-Za-z]:[\\/]/.test(gitDir)) return path.resolve(gitDir)
    return path.resolve(worktree, gitDir)
  } catch {
    return ""
  }
}

export async function resolveGitDirAsync(worktree: string, env: Env = process.env): Promise<string> {
  if (!worktree) return ""
  try {
    const gitDir = await gitOutputAsync(["rev-parse", "--git-dir"], worktree, env)
    if (path.isAbsolute(gitDir) || /^[A-Za-z]:[\\/]/.test(gitDir)) return path.resolve(gitDir)
    return path.resolve(worktree, gitDir)
  } catch {
    return ""
  }
}

export function resolveHeadPath(worktree: string): string {
  const gitDir = resolveGitDir(worktree)
  return gitDir ? path.join(gitDir, "HEAD") : ""
}

export async function resolveHeadPathAsync(worktree: string, env: Env = process.env): Promise<string> {
  const gitDir = await resolveGitDirAsync(worktree, env)
  return gitDir ? path.join(gitDir, "HEAD") : ""
}

export function readCurrentBranch(worktree: string): string {
  if (!worktree) return ""
  try {
    return gitOutput(["branch", "--show-current"], worktree)
  } catch {
    return ""
  }
}

async function readCurrentBranchAsync(worktree: string, env: Env = process.env): Promise<string> {
  if (!worktree) return ""
  try {
    return await gitOutputAsync(["branch", "--show-current"], worktree, env)
  } catch {
    return ""
  }
}

function readMarkerBranch(marker: string): string {
  return readMarkerField(marker, 0)
}

async function readMarkerBranchAsync(marker: string): Promise<string> {
  return readMarkerFieldAsync(marker, 0)
}

function clonePluginEnabled(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry) => typeof entry[1] === "boolean"))
}

function restorePluginEnabled(api: TuiApi, value: Record<string, boolean>): void {
  try {
    api?.kv?.set?.(PLUGIN_ENABLED_KV, clonePluginEnabled(value))
  } catch {
    // Runtime plugin visibility should not fail the TUI plugin itself.
  }
}

function findPlugin(api: TuiApi, id: string): TuiPluginRecord | undefined {
  try {
    return api?.plugins?.list?.().find((item) => item.id === id)
  } catch {
    return undefined
  }
}

async function reconcileBuiltinFilesPlugin(api: TuiApi, options: BuiltinFilesOptions = {}): Promise<void> {
  const shouldHide = builtinFilesState.refs > 0

  if (shouldHide && !builtinFilesState.hidden) {
    const plugin = findPlugin(api, BUILTIN_FILES_PLUGIN_ID)
    if (!plugin?.active || plugin.enabled === false) return

    const previousEnabled = clonePluginEnabled(api?.kv?.get?.(PLUGIN_ENABLED_KV, {}))
    const ok = await api.plugins.deactivate(BUILTIN_FILES_PLUGIN_ID)
    if (!ok) return

    builtinFilesState.hidden = true
    builtinFilesState.previousEnabled = previousEnabled
    restorePluginEnabled(api, previousEnabled)
    return
  }

  if (!shouldHide && builtinFilesState.hidden) {
    const previousEnabled = builtinFilesState.previousEnabled || {}
    if (previousEnabled[BUILTIN_FILES_PLUGIN_ID] !== false) await api.plugins.activate(BUILTIN_FILES_PLUGIN_ID)
    builtinFilesState.hidden = false
    builtinFilesState.previousEnabled = undefined
    restorePluginEnabled(api, previousEnabled)
    return
  }

  if (typeof options.onSettled === "function") options.onSettled({ hidden: builtinFilesState.hidden })
}

function queueBuiltinFilesReconcile(api: TuiApi, options: BuiltinFilesOptions = {}): Promise<void> {
  builtinFilesState.task = builtinFilesState.task
    .then(() => reconcileBuiltinFilesPlugin(api, options))
    .catch((error) => {
      if (typeof options.onError === "function") options.onError(error, "builtin-files")
    })
  return builtinFilesState.task
}

export function acquireBuiltinFilesHidden(api: TuiApi, options: BuiltinFilesOptions = {}): () => void {
  let released = false
  builtinFilesState.refs += 1
  void queueBuiltinFilesReconcile(api, options)

  return () => {
    if (released) return
    released = true
    builtinFilesState.refs = Math.max(0, builtinFilesState.refs - 1)
    void queueBuiltinFilesReconcile(api, options)
  }
}

export function builtinFilesHiddenStatus(): { refs: number; hidden: boolean } {
  return {
    refs: builtinFilesState.refs,
    hidden: builtinFilesState.hidden,
  }
}

function readMarkerInitialHead(marker: string): string {
  return readMarkerField(marker, 2)
}

async function readMarkerInitialHeadAsync(marker: string): Promise<string> {
  return readMarkerFieldAsync(marker, 2)
}

function readMarkerField(marker: string, index: number): string {
  if (!marker || !fs.existsSync(marker)) return ""
  try {
    return fs.readFileSync(marker, "utf8").trim().split(/\s+/)[index] || ""
  } catch {
    return ""
  }
}

async function readMarkerFieldAsync(marker: string, index: number): Promise<string> {
  if (!marker || !(await pathExistsAsync(marker))) return ""
  try {
    return (await fs.promises.readFile(marker, "utf8")).trim().split(/\s+/)[index] || ""
  } catch {
    return ""
  }
}

function worktreeFromList(repo: string, branch: string): string {
  if (!repo || !branch) return ""

  let current = ""
  try {
    for (const raw of gitOutput(["worktree", "list", "--porcelain"], repo).split(/\r?\n/)) {
      const line = raw.trimEnd()
      if (line.startsWith("worktree ")) {
        current = line.slice("worktree ".length)
        continue
      }
      if (line === `branch refs/heads/${branch}` && current && fs.existsSync(current)) return current
    }
  } catch {
    return ""
  }

  return ""
}

async function worktreeFromListAsync(repo: string, branch: string, env: Env = process.env): Promise<string> {
  if (!repo || !branch) return ""

  let current = ""
  try {
    for (const raw of (await gitOutputAsync(["worktree", "list", "--porcelain"], repo, env)).split(/\r?\n/)) {
      const line = raw.trimEnd()
      if (line.startsWith("worktree ")) {
        current = line.slice("worktree ".length)
        continue
      }
      if (line === `branch refs/heads/${branch}` && current && (await pathExistsAsync(current))) return current
    }
  } catch {
    return ""
  }

  return ""
}

function configuredWorktreesDirs(repo: string, env: Env): string[] {
  const dirs: string[] = []
  const add = (value: string) => {
    if (!value) return
    const resolved = path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) ? path.resolve(value) : path.resolve(repo, value)
    if (!dirs.includes(resolved)) dirs.push(resolved)
  }

  add(envValue(env, "OPENCODE_WORKTREES_DIR"))
  add(envValue(env, "WORKTREE_WORKTREES_DIR"))
  add(path.join(".opencode", "worktree", "worktrees"))
  return dirs
}

function worktreeFromKnownLayout(repo: string, branch: string, env: Env): string {
  if (!repo || !branch) return ""
  for (const dir of configuredWorktreesDirs(repo, env)) {
    const candidate = path.join(dir, branch)
    if (fs.existsSync(candidate)) return candidate
  }
  return ""
}

async function worktreeFromKnownLayoutAsync(repo: string, branch: string, env: Env): Promise<string> {
  if (!repo || !branch) return ""
  for (const dir of configuredWorktreesDirs(repo, env)) {
    const candidate = path.join(dir, branch)
    if (await pathExistsAsync(candidate)) return candidate
  }
  return ""
}

function worktreeBranchPrefix(env: Env): string {
  return envValue(env, "OPENCODE_WORKTREE_BRANCH_PREFIX") || envValue(env, "WORKTREE_BRANCH_PREFIX") || "wt"
}

function isWorktreeBranch(branch: string, env: Env): boolean {
  const prefix = worktreeBranchPrefix(env).replace(/[*?].*$/, "")
  return !!branch && !!prefix && branch.startsWith(`${prefix}-`)
}

function isLikelyWorktreePath(file: string | undefined, env: Env): boolean {
  if (!file) return false
  const prefix = worktreeBranchPrefix(env).replace(/[*?].*$/, "")
  const resolved = path.resolve(file)
  const name = path.basename(resolved)
  if (!prefix || !name.startsWith(`${prefix}-`)) return false

  const normalized = normalizePathForCompare(resolved).replace(/\\/g, "/")
  return normalized.includes("/.opencode/worktree/worktrees/")
}

function inferCurrentWorktree(repo: string, env: Env): string {
  if (!repo) return ""
  const branch = readCurrentBranch(repo)
  if (!isWorktreeBranch(branch, env)) return ""

  const worktree = worktreeFromList(repo, branch)
  if (!worktree) return ""
  return path.basename(path.resolve(worktree)) === branch ? path.resolve(worktree) : ""
}

async function inferCurrentWorktreeAsync(repo: string, env: Env): Promise<string> {
  if (!repo) return ""
  const branch = await readCurrentBranchAsync(repo, env)
  if (!isWorktreeBranch(branch, env)) return ""

  const worktree = await worktreeFromListAsync(repo, branch, env)
  if (!worktree) return ""
  return path.basename(path.resolve(worktree)) === branch ? path.resolve(worktree) : ""
}

export function resolveWorktree(input: WorktreeResolveInput = {}): string {
  const env = input.env || process.env
  const direct = envValue(env, "OPENCODE_WORKTREE_PATH")
  if (envValue(env, "OPENCODE_WORKTREE_ACTIVE") === "1" && direct && fs.existsSync(direct)) return path.resolve(direct)

  const base = input.directory || input.worktreeHint || envValue(env, "OPENCODE_WORKTREE_REPO") || process.cwd()
  const repo = resolveRepo(base)
  const marker = resolveWorktreeMarker({ ...input, directory: base, env })
  const branch = readMarkerBranch(marker)
  if (!branch) return inferCurrentWorktree(repo, env)

  return worktreeFromList(repo, branch) || worktreeFromKnownLayout(repo, branch, env)
}

export async function resolveWorktreeAsync(input: WorktreeResolveInput = {}): Promise<string> {
  const env = input.env || process.env
  const direct = envValue(env, "OPENCODE_WORKTREE_PATH")
  if (envValue(env, "OPENCODE_WORKTREE_ACTIVE") === "1" && direct && (await pathExistsAsync(direct))) return path.resolve(direct)

  const base = input.directory || input.worktreeHint || envValue(env, "OPENCODE_WORKTREE_REPO") || process.cwd()
  const repo = await resolveRepoAsync(base, env)
  const marker = await resolveWorktreeMarkerAsync({ ...input, directory: base, env })
  const branch = await readMarkerBranchAsync(marker)
  if (!branch) return inferCurrentWorktreeAsync(repo, env)

  return (await worktreeFromListAsync(repo, branch, env)) || (await worktreeFromKnownLayoutAsync(repo, branch, env))
}

export function resolveWorktreeMarker(input: WorktreeResolveInput = {}): string {
  const env = input.env || process.env
  const base = input.directory || input.worktreeHint || input.worktree || envValue(env, "OPENCODE_WORKTREE_REPO") || process.cwd()
  const repo = resolveRepo(base)
  if (!repo) return ""

  const common = resolveGitCommonDir(repo)
  if (!common) return ""

  const ids = worktreeSessionIDCandidates(input.sessionID, env)
  for (const id of ids) {
    const marker = path.join(common, "worktree-markers", id)
    if (fs.existsSync(marker)) return marker
  }
  return ids[0] ? path.join(common, "worktree-markers", ids[0]) : ""
}

export async function resolveWorktreeMarkerAsync(input: WorktreeResolveInput = {}): Promise<string> {
  const env = input.env || process.env
  const base = input.directory || input.worktreeHint || input.worktree || envValue(env, "OPENCODE_WORKTREE_REPO") || process.cwd()
  const repo = await resolveRepoAsync(base, env)
  if (!repo) return ""

  const common = await resolveGitCommonDirAsync(repo, env)
  if (!common) return ""

  const ids = worktreeSessionIDCandidates(input.sessionID, env)
  for (const id of ids) {
    const marker = path.join(common, "worktree-markers", id)
    if (await pathExistsAsync(marker)) return marker
  }
  return ids[0] ? path.join(common, "worktree-markers", ids[0]) : ""
}

function gitOutputOrEmpty(args: string[], cwd: string): string {
  try {
    return gitOutput(args, cwd)
  } catch {
    return ""
  }
}

async function gitOutputOrEmptyAsync(args: string[], cwd: string, env: Env = process.env): Promise<string> {
  try {
    return await gitOutputAsync(args, cwd, env)
  } catch {
    return ""
  }
}

function gitCommitExists(worktree: string, ref: string): boolean {
  if (!worktree || !ref) return false
  try {
    gitOutput(["cat-file", "-e", `${ref}^{commit}`], worktree)
    return true
  } catch {
    return false
  }
}

async function gitCommitExistsAsync(worktree: string, ref: string, env: Env = process.env): Promise<boolean> {
  if (!worktree || !ref) return false
  try {
    await gitOutputAsync(["cat-file", "-e", `${ref}^{commit}`], worktree, env)
    return true
  } catch {
    return false
  }
}

export function resolveWorktreeBaseRef(input: WorktreeResolveInput = {}, worktree = ""): string {
  const env = input.env || process.env
  const explicit = input.baseRef || envValue(env, "OPENCODE_WORKTREE_BASE_REF")
  if (gitCommitExists(worktree, explicit)) return explicit

  const mainBase = resolveMainMergeBase(worktree, env)
  if (mainBase) return mainBase

  const marker = resolveWorktreeMarker({ ...input, worktree, env })
  const initialHead = readMarkerInitialHead(marker)
  return gitCommitExists(worktree, initialHead) ? initialHead : ""
}

export async function resolveWorktreeBaseRefAsync(input: WorktreeResolveInput = {}, worktree = ""): Promise<string> {
  const env = input.env || process.env
  const explicit = input.baseRef || envValue(env, "OPENCODE_WORKTREE_BASE_REF")
  if (await gitCommitExistsAsync(worktree, explicit, env)) return explicit

  const mainBase = await resolveMainMergeBaseAsync(worktree, env)
  if (mainBase) return mainBase

  const marker = await resolveWorktreeMarkerAsync({ ...input, worktree, env })
  const initialHead = await readMarkerInitialHeadAsync(marker)
  return (await gitCommitExistsAsync(worktree, initialHead, env)) ? initialHead : ""
}

function resolveMainMergeBase(worktree: string, env: Env = process.env): string {
  if (!worktree) return ""
  const current = readCurrentBranch(worktree)
  const candidates = [
    envValue(env, "OPENCODE_WORKTREE_COMPARE_REF"),
    "main",
    "master",
    "origin/main",
    "origin/master",
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (candidate === current || !gitCommitExists(worktree, candidate)) continue
    const base = gitOutputOrEmpty(["merge-base", "HEAD", candidate], worktree)
    if (gitCommitExists(worktree, base)) return base
  }
  return ""
}

async function resolveMainMergeBaseAsync(worktree: string, env: Env = process.env): Promise<string> {
  if (!worktree) return ""
  const current = await readCurrentBranchAsync(worktree, env)
  const candidates = [
    envValue(env, "OPENCODE_WORKTREE_COMPARE_REF"),
    "main",
    "master",
    "origin/main",
    "origin/master",
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (candidate === current || !(await gitCommitExistsAsync(worktree, candidate, env))) continue
    const base = await gitOutputOrEmptyAsync(["merge-base", "HEAD", candidate], worktree, env)
    if (await gitCommitExistsAsync(worktree, base, env)) return base
  }
  return ""
}

function parseNumstatCount(value: unknown): number {
  const next = Number.parseInt(String(value || ""), 10)
  return Number.isFinite(next) && next > 0 ? next : 0
}

function addChangedFile(files: Map<string, ChangedFile>, file: unknown, additions = 0, deletions = 0): void {
  const name = String(file || "").trim()
  if (!name) return
  const current = files.get(name) || { file: name, additions: 0, deletions: 0 }
  current.additions += additions
  current.deletions += deletions
  files.set(name, current)
}

function addNumstat(files: Map<string, ChangedFile>, output: string): void {
  for (const raw of String(output || "").split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line) continue
    const parts = line.split("\t")
    if (parts.length < 3) continue
    addChangedFile(files, parts.slice(2).join("\t"), parseNumstatCount(parts[0]), parseNumstatCount(parts[1]))
  }
}

function addUntracked(files: Map<string, ChangedFile>, output: string): void {
  for (const raw of String(output || "").split(/\r?\n/)) {
    const file = raw.trimEnd()
    if (file) addChangedFile(files, file)
  }
}

export function readWorktreeChangedFiles(worktree: string, input: WorktreeResolveInput = {}): ChangedFile[] {
  if (!worktree || !fs.existsSync(worktree)) return []

  const files = new Map<string, ChangedFile>()
  const baseRef = resolveWorktreeBaseRef(input, worktree)
  if (baseRef) addNumstat(files, gitOutputOrEmpty(["diff", "--numstat", `${baseRef}..HEAD`, "--"], worktree))

  addNumstat(files, gitOutputOrEmpty(["diff", "--numstat", "--cached", "--"], worktree))
  addNumstat(files, gitOutputOrEmpty(["diff", "--numstat", "--"], worktree))
  addUntracked(files, gitOutputOrEmpty(["ls-files", "--others", "--exclude-standard"], worktree))

  return Array.from(files.values()).sort((a, b) => a.file.localeCompare(b.file))
}

export async function readWorktreeChangedFilesAsync(worktree: string, input: WorktreeResolveInput = {}): Promise<ChangedFile[]> {
  if (!worktree || !(await pathExistsAsync(worktree))) return []

  const env = input.env || process.env
  const files = new Map<string, ChangedFile>()
  const baseRef = await resolveWorktreeBaseRefAsync(input, worktree)
  const [headDiff, cachedDiff, workingDiff, untracked] = await Promise.all([
    baseRef ? gitOutputOrEmptyAsync(["diff", "--numstat", `${baseRef}..HEAD`, "--"], worktree, env) : Promise.resolve(""),
    gitOutputOrEmptyAsync(["diff", "--numstat", "--cached", "--"], worktree, env),
    gitOutputOrEmptyAsync(["diff", "--numstat", "--"], worktree, env),
    gitOutputOrEmptyAsync(["ls-files", "--others", "--exclude-standard"], worktree, env),
  ])

  addNumstat(files, headDiff)
  addNumstat(files, cachedDiff)
  addNumstat(files, workingDiff)
  addUntracked(files, untracked)

  return Array.from(files.values()).sort((a, b) => a.file.localeCompare(b.file))
}

function isHeadEvent(filename: string | Buffer | null): boolean {
  if (!filename) return true
  const text = Buffer.isBuffer(filename) ? filename.toString("utf8") : String(filename)
  return path.basename(text).toLowerCase() === "head"
}

function closeWatcher(state: BranchObserverState): void {
  if (!state.watcher) return
  state.closingWatcher = true
  try {
    state.watcher.close()
  } catch {
    // Watchers are best-effort; polling remains the fallback.
  }
  state.watcher = undefined
  state.watcherActive = false
  state.closingWatcher = false
}

function clearTimer(timer?: ReturnType<typeof setTimeout>): void {
  if (timer) clearTimeout(timer)
}

function clearIntervalTimer(timer?: ReturnType<typeof setInterval>): void {
  if (timer) clearInterval(timer)
}

export function createBranchObserver(options: BranchObserverOptions = {}) {
  const env = options.env || process.env
  const debounceMs = parsePositiveInt(options.debounceMs, DEFAULT_DEBOUNCE_MS)
  const state: BranchObserverState = {
    branch: "",
    worktree: "",
    headPath: "",
    watcher: undefined,
    watcherActive: false,
    closingWatcher: false,
    pollTimer: undefined,
    pollMs: 0,
    debounceTimer: undefined,
    refreshing: false,
    pendingRefresh: false,
    stopped: false,
  }

  const debug = (message: string, extra: Record<string, unknown> = {}) => {
    if (envValue(env, "AISB_OPENCODE_BRANCH_DEBUG") !== "1") return
    console.error(`[worktree.branch] ${message}`, extra)
  }

  const reportError = (error: unknown, phase: string) => {
    const err = error as { message?: unknown }
    debug(`branch refresh ${phase} failed`, { error: commandOutput(err?.message || error) })
    if (typeof options.onError === "function") options.onError(error, phase)
  }

  const startPolling = () => {
    if (state.stopped) return
    const nextMs = branchRefreshMs(env, state.watcherActive)
    if (state.pollTimer && state.pollMs === nextMs) return
    clearIntervalTimer(state.pollTimer)
    state.pollMs = nextMs
    state.pollTimer = setInterval(() => {
      void observer.refresh("poll")
    }, nextMs)
    unrefTimer(state.pollTimer)
  }

  const startWatcher = async (worktree: string) => {
    if (state.stopped) return
    closeWatcher(state)
    state.headPath = ""

    if (!branchWatchEnabled(env) || !worktree) {
      startPolling()
      return
    }

    const headPath = await resolveHeadPathAsync(worktree, env)
    if (state.stopped) return
    if (!headPath || !(await pathExistsAsync(headPath))) {
      if (state.stopped) return
      startPolling()
      return
    }
    if (state.stopped) return

    state.headPath = headPath
    try {
      const watcher = fs.watch(path.dirname(headPath), { persistent: false }, (_event, filename) => {
        if (!isHeadEvent(filename)) return
        observer.schedule("head-watch")
      })
      watcher.on("error", (error) => {
        if (state.stopped) return
        reportError(error, "watch")
        closeWatcher(state)
        startPolling()
      })
      watcher.on("close", () => {
        if (state.closingWatcher || state.stopped) return
        state.watcherActive = false
        startPolling()
      })
      if (typeof watcher.unref === "function") watcher.unref()
      if (state.stopped) {
        watcher.close()
        return
      }
      state.watcher = watcher
      state.watcherActive = true
    } catch (error) {
      reportError(error, "watch")
      state.watcherActive = false
    }

    startPolling()
  }

  const resolveWorktree = async () => {
    const worktree = typeof options.getWorktree === "function" ? options.getWorktree() : resolveWorktreeAsync(options)
    const resolved = await Promise.resolve(worktree)
    return resolved ? path.resolve(resolved) : ""
  }

  const refresh = async (reason: string) => {
    if (state.stopped) return
    if (state.refreshing) {
      state.pendingRefresh = true
      return
    }

    state.refreshing = true
    try {
      const worktree = await resolveWorktree()
      if (state.stopped) return
      if (worktree !== state.worktree) {
        state.worktree = worktree
        await startWatcher(worktree)
        if (state.stopped) return
      }

      const branch = worktree ? await readCurrentBranchAsync(worktree, env) : ""
      if (state.stopped) return
      if (branch !== state.branch) {
        state.branch = branch
        if (typeof options.onChange === "function") options.onChange({ branch, worktree, reason })
      }
    } catch (error) {
      reportError(error, "refresh")
    } finally {
      state.refreshing = false
      if (state.pendingRefresh) {
        state.pendingRefresh = false
        observer.schedule("pending")
      }
    }
  }

  const observer = {
    refresh(reason = "manual") {
      return refresh(reason)
    },

    schedule(reason = "schedule") {
      if (state.stopped) return
      clearTimer(state.debounceTimer)
      state.debounceTimer = setTimeout(() => {
        state.debounceTimer = undefined
        void observer.refresh(reason)
      }, debounceMs)
      unrefTimer(state.debounceTimer)
    },

    close() {
      state.stopped = true
      clearTimer(state.debounceTimer)
      clearIntervalTimer(state.pollTimer)
      closeWatcher(state)
    },

    status() {
      return {
        branch: state.branch,
        worktree: state.worktree,
        headPath: state.headPath,
        watcherActive: state.watcherActive,
        pollMs: state.pollMs,
      }
    },
  }

  observer.schedule("start")
  startPolling()
  return observer
}

function filesSignature(files: ChangedFile[], worktree: string): string {
  return JSON.stringify({ files, worktree })
}

export function createChangedFilesObserver(options: ChangedFilesObserverOptions = {}) {
  const env = options.env || process.env
  const debounceMs = parsePositiveInt(options.debounceMs, DEFAULT_DEBOUNCE_MS)
  const state: ChangedFilesObserverState = {
    files: [],
    signature: "[]",
    worktree: "",
    pollTimer: undefined,
    pollMs: 0,
    debounceTimer: undefined,
    refreshing: false,
    pendingRefresh: false,
    stopped: false,
  }

  const debug = (message: string, extra: Record<string, unknown> = {}) => {
    if (envValue(env, "AISB_OPENCODE_FILES_DEBUG") !== "1") return
    console.error(`[worktree.files] ${message}`, extra)
  }

  const reportError = (error: unknown, phase: string) => {
    const err = error as { message?: unknown }
    debug(`files refresh ${phase} failed`, { error: commandOutput(err?.message || error) })
    if (typeof options.onError === "function") options.onError(error, phase)
  }

  const startPolling = () => {
    const nextMs = filesRefreshMs(env)
    if (nextMs <= 0) {
      clearIntervalTimer(state.pollTimer)
      state.pollTimer = undefined
      state.pollMs = 0
      return
    }
    if (state.pollTimer && state.pollMs === nextMs) return
    clearIntervalTimer(state.pollTimer)
    state.pollMs = nextMs
    state.pollTimer = setInterval(() => {
      void observer.refresh("poll")
    }, nextMs)
    unrefTimer(state.pollTimer)
  }

  const resolveWorktree = async () => {
    const worktree = typeof options.getWorktree === "function" ? options.getWorktree() : resolveWorktreeAsync(options)
    const resolved = await Promise.resolve(worktree)
    return resolved ? path.resolve(resolved) : ""
  }

  const refresh = async (reason: string) => {
    if (state.stopped) return
    if (state.refreshing) {
      state.pendingRefresh = true
      return
    }

    state.refreshing = true
    try {
      const worktree = await resolveWorktree()
      const files = worktree ? await readWorktreeChangedFilesAsync(worktree, { ...options, worktree, env }) : []
      if (state.stopped) return
      const signature = filesSignature(files, worktree)
      state.worktree = worktree
      if (signature !== state.signature) {
        state.files = files
        state.signature = signature
        if (typeof options.onChange === "function") options.onChange({ files, worktree, reason })
      }
    } catch (error) {
      reportError(error, "refresh")
    } finally {
      state.refreshing = false
      if (state.pendingRefresh) {
        state.pendingRefresh = false
        observer.schedule("pending")
      }
    }
  }

  const observer = {
    refresh(reason = "manual") {
      return refresh(reason)
    },

    schedule(reason = "schedule") {
      if (state.stopped) return
      clearTimer(state.debounceTimer)
      state.debounceTimer = setTimeout(() => {
        state.debounceTimer = undefined
        void observer.refresh(reason)
      }, debounceMs)
      unrefTimer(state.debounceTimer)
    },

    close() {
      state.stopped = true
      clearTimer(state.debounceTimer)
      clearIntervalTimer(state.pollTimer)
    },

    status() {
      return {
        files: state.files,
        worktree: state.worktree,
        pollMs: state.pollMs,
      }
    },
  }

  defer(() => {
    void observer.refresh("start")
  })
  startPolling()
  return observer
}
