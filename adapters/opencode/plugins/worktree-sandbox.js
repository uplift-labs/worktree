import { execFile, spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))

const state = {
  sessions: new Map(),
  bootstraps: new Map(),
  warnings: new Map(),
  heartbeats: new Map(),
  cleanupRegistered: false,
  currentSession: "",
}

const PATH_TOOLS = new Set(["read", "edit", "write", "lsp"])
const SEARCH_TOOLS = new Set(["grep", "glob"])
const PATCH_TOOLS = new Set(["apply_patch", "patch"])
const SANDBOXED_TOOLS = new Set([...PATH_TOOLS, ...SEARCH_TOOLS, ...PATCH_TOOLS, "bash"])
const DEFAULT_EXEC_MAX_BUFFER = 10 * 1024 * 1024
const DEFAULT_GIT_TIMEOUT_MS = 3000
const PENDING_SYSTEM_CONTEXT = [
  "worktree-sandbox is preparing a sandbox for this session.",
  "Use relative project paths; supported tools will be routed to the sandbox before execution.",
  "Do not target the main repository path directly.",
].join(" ")
const CHECKING_SYSTEM_CONTEXT = [
  "worktree-sandbox is checking whether this session needs a sandbox.",
  "Use relative project paths; supported tools will wait for sandbox readiness when sandboxing applies.",
  "Do not target the main repository path directly.",
].join(" ")

function envValue(name) {
  return process.env[name] || ""
}

function commandOutput(value) {
  if (!value) return ""
  if (Buffer.isBuffer(value)) return value.toString("utf8")
  return String(value)
}

function parsePositiveInt(value, fallback) {
  const next = Number.parseInt(String(value || ""), 10)
  return Number.isFinite(next) && next > 0 ? next : fallback
}

function gitTimeoutMs() {
  return parsePositiveInt(envValue("AISB_OPENCODE_GIT_TIMEOUT_MS"), DEFAULT_GIT_TIMEOUT_MS)
}

async function pathExistsAsync(file) {
  if (!file) return false
  try {
    await fs.promises.access(file)
    return true
  } catch {
    return false
  }
}

function toPosix(file) {
  return String(file || "").replace(/\\/g, "/")
}

function normalize(file) {
  const resolved = path.resolve(file)
  return process.platform === "win32" ? toPosix(resolved).toLowerCase() : toPosix(resolved)
}

function isWithin(child, parent) {
  if (!child || !parent) return false
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel))
}

function absolutize(file, base) {
  if (!file) return ""
  return path.isAbsolute(file) || /^[A-Za-z]:[\\/]/.test(file) ? path.resolve(file) : path.resolve(base, file)
}

function isExplicitAbsolute(file) {
  return path.isAbsolute(file || "") || /^[A-Za-z]:[\\/]/.test(file || "")
}

function sanitizeId(value) {
  const safe = String(value || "")
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
  return safe || `${Date.now()}-${process.pid}`
}

function compactOpenCodeSessionID(value) {
  const safe = sanitizeId(value)
  if (safe.startsWith("oc-")) return safe

  const sessionMatch = safe.match(/^(?:opencode-)?ses-([a-zA-Z0-9]+)/)
  if (sessionMatch) return `oc-${sessionMatch[1].slice(0, 12)}`

  const legacy = safe.startsWith("opencode-") ? safe.slice("opencode-".length) : safe
  return `oc-${legacy.slice(0, 24)}`
}

function sandboxSessionID(sessionID) {
  return compactOpenCodeSessionID(sessionID || envValue("OPENCODE_RUN_ID") || `${Date.now()}-${process.pid}`)
}

function emptyConfig() {
  return {
    active: false,
    session: "",
    repo: "",
    root: "",
    worktree: "",
    worktreesDir: ".sandbox/worktrees",
    branchPrefix: "wt",
    branchGlob: "wt-*",
    auto: false,
  }
}

async function hasCoreAsync(root) {
  return !!root && (await pathExistsAsync(path.join(root, "core", "cmd", "sandbox-init.sh")))
}

async function findSandboxRootAsync(repo) {
  const candidates = []
  if (envValue("OPENCODE_SANDBOX_ROOT")) candidates.push(envValue("OPENCODE_SANDBOX_ROOT"))
  if (repo) {
    candidates.push(path.join(repo, ".uplift", "sandbox"))
    candidates.push(path.join(repo, ".sandbox"))
  }

  let cur = MODULE_DIR
  for (let i = 0; i < 8; i += 1) {
    candidates.push(cur)
    const next = path.dirname(cur)
    if (next === cur) break
    cur = next
  }

  for (const candidate of candidates) {
    if (await hasCoreAsync(candidate)) return candidate
  }
  return ""
}

async function gitOutputAsync(args, cwd) {
  return (await execFileAsync("git", ["-C", cwd, ...args], { timeout: gitTimeoutMs() })).trim()
}

async function resolveRepoAsync(base) {
  try {
    return await gitOutputAsync(["rev-parse", "--show-toplevel"], base)
  } catch {
    return ""
  }
}

async function resolveGitCommonDirAsync(repo) {
  try {
    const common = await gitOutputAsync(["rev-parse", "--git-common-dir"], repo)
    if (path.isAbsolute(common) || /^[A-Za-z]:[\\/]/.test(common)) return path.resolve(common)
    return path.resolve(repo, common)
  } catch {
    return ""
  }
}

function worktreesDir(repo, root) {
  if (envValue("WORKTREE_SANDBOX_WORKTREES_DIR")) return envValue("WORKTREE_SANDBOX_WORKTREES_DIR")
  if (envValue("OPENCODE_SANDBOX_WORKTREES_DIR")) return envValue("OPENCODE_SANDBOX_WORKTREES_DIR")
  if (repo && root && isWithin(root, repo) && normalize(root) !== normalize(repo)) {
    return `${toPosix(path.relative(repo, root))}/worktrees`
  }
  return ".sandbox/worktrees"
}

function branchPrefix() {
  return envValue("WORKTREE_SANDBOX_BRANCH_PREFIX") || envValue("OPENCODE_SANDBOX_BRANCH_PREFIX") || "wt"
}

function branchGlob(prefix) {
  return prefix.includes("*") ? prefix : `${prefix}-*`
}

let cachedBash = ""
let cachedBashPromise = null

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        maxBuffer: DEFAULT_EXEC_MAX_BUFFER,
        windowsHide: true,
        ...options,
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout
          error.stderr = stderr
          reject(error)
          return
        }
        resolve(String(stdout || ""))
      },
    )
  })
}

async function resolveBashAsync() {
  if (cachedBash) return cachedBash
  if (cachedBashPromise) return cachedBashPromise

  cachedBashPromise = (async () => {
    const candidates = []
    const add = (candidate) => {
      if (candidate && !candidates.includes(candidate)) candidates.push(candidate)
    }

    add(envValue("WORKTREE_SANDBOX_BASH"))
    add(envValue("GIT_BASH"))
    if (process.platform === "win32") {
      add("C:\\Program Files\\Git\\bin\\bash.exe")
      add("C:\\Program Files\\Git\\usr\\bin\\bash.exe")
      add("C:\\Program Files (x86)\\Git\\bin\\bash.exe")
    }
    add("bash")

    for (const candidate of candidates) {
      if ((path.isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate)) && !(await pathExistsAsync(candidate))) continue
      try {
        await execFileAsync(candidate, ["--version"], { timeout: 3000, maxBuffer: 1024 * 1024 })
        cachedBash = candidate
        return candidate
      } catch {
        // Try the next candidate. On Windows, bare bash can resolve to WSL.
      }
    }

    throw new Error("bash command not found")
  })()

  try {
    return await cachedBashPromise
  } finally {
    if (!cachedBash) cachedBashPromise = null
  }
}

async function execSandboxAsync(root, rel, args, options = {}) {
  const bash = await resolveBashAsync()
  return execFileAsync(bash, [path.join(root, rel), ...args], {
    cwd: options.cwd || root,
    ...options,
  })
}

async function markerPathAsync(cfg) {
  if (cfg.marker) return cfg.marker
  const common = await resolveGitCommonDirAsync(cfg.repo)
  return common ? path.join(common, "sandbox-markers", cfg.session) : ""
}

function setProcessEnv(cfg) {
  process.env.OPENCODE_SANDBOX_ACTIVE = "1"
  process.env.OPENCODE_SANDBOX_SOURCE = "opencode-plugin"
  process.env.OPENCODE_SANDBOX_SESSION = cfg.session
  process.env.OPENCODE_SANDBOX_REPO = cfg.repo
  process.env.OPENCODE_SANDBOX_ROOT = cfg.root
  process.env.OPENCODE_SANDBOX_WORKTREE = cfg.worktree
  process.env.OPENCODE_SANDBOX_WORKTREES_DIR = cfg.worktreesDir
  process.env.OPENCODE_SANDBOX_BRANCH_PREFIX = cfg.branchPrefix
}

async function touchMarkerAsync(cfg) {
  const marker = await markerPathAsync(cfg)
  if (!marker || !(await pathExistsAsync(marker))) return
  const now = new Date()
  try {
    await fs.promises.utimes(marker, now, now)
  } catch {
    // Heartbeat/lifecycle TTL is a safety net if this best-effort touch fails.
  }
}

function killHeartbeatProcess(cfg) {
  const hb = state.heartbeats.get(cfg.session)
  if (hb) {
    try {
      hb.kill()
    } catch {
      // The process may already be gone.
    }
    state.heartbeats.delete(cfg.session)
  }
}

async function killHeartbeatAsync(cfg) {
  killHeartbeatProcess(cfg)

  const marker = await markerPathAsync(cfg)
  const sidecar = marker ? `${marker}.hb` : ""
  if (!sidecar || !(await pathExistsAsync(sidecar))) return

  try {
    const pid = (await fs.promises.readFile(sidecar, "utf8")).trim().split(/\s+/)[0]
    if (pid) {
      try {
        process.kill(Number(pid))
      } catch {
        // The heartbeat may already have exited.
      }
    }
    await fs.promises.rm(sidecar, { force: true })
  } catch {
    // Cleanup must never make OpenCode fail to exit.
  }
}

function cleanupArgs(cfg) {
  return [
    "--repo",
    cfg.repo,
    "--session",
    cfg.session,
    "--trust-dead",
    "--worktrees-dir",
    cfg.worktreesDir,
    "--branch-prefix",
    cfg.branchGlob,
  ]
}

async function cleanupConfigAsync(cfg) {
  if (!cfg.active || !cfg.auto) return
  await killHeartbeatAsync(cfg)
  try {
    await execSandboxAsync(cfg.root, "core/cmd/sandbox-cleanup.sh", cleanupArgs(cfg))
  } catch {
    // Fail open. Stale markers are still TTL-managed by sandbox-lifecycle.
  }
}

function detachedBashCommand() {
  return cachedBash || envValue("WORKTREE_SANDBOX_BASH") || envValue("GIT_BASH") || "bash"
}

function cleanupConfigDetached(cfg) {
  if (!cfg.active || !cfg.auto) return
  killHeartbeatProcess(cfg)
  try {
    const child = spawn(detachedBashCommand(), [path.join(cfg.root, "core/cmd/sandbox-cleanup.sh"), ...cleanupArgs(cfg)], {
      cwd: cfg.root,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    })
    child.unref()
  } catch {
    // Process exit cleanup is best-effort; heartbeat/lifecycle TTL remains.
  }
}

function registerProcessCleanup() {
  if (state.cleanupRegistered) return
  state.cleanupRegistered = true
  process.once("exit", () => {
    for (const cfg of state.sessions.values()) cleanupConfigDetached(cfg)
  })
}

async function launchHeartbeatAsync(cfg) {
  const marker = await markerPathAsync(cfg)
  if (!marker || !(await pathExistsAsync(marker))) return
  const bash = await resolveBashAsync()

  const pidArgs = process.platform === "win32" ? ["--pid", "0", "--parent-winpid", String(process.pid)] : ["--pid", String(process.pid)]
  const child = spawn(
    bash,
    [
      path.join(cfg.root, "core/lib/heartbeat.sh"),
      ...pidArgs,
      "--marker",
      marker,
      "--repo",
      cfg.repo,
      "--sandbox-root",
      cfg.root,
      "--worktrees-dir",
      cfg.worktreesDir,
      "--branch-prefix",
      cfg.branchGlob,
      "--owner-process-names",
      "opencode,opencode.exe,node,node.exe,bun,bun.exe",
    ],
    { detached: true, stdio: "ignore", windowsHide: true },
  )
  child.unref()
  state.heartbeats.set(cfg.session, child)
}

function deferBootstrap(fn) {
  return new Promise((resolve) => {
    const run = () => resolve()
    if (typeof setImmediate === "function") setImmediate(run)
    else setTimeout(run, 0)
  }).then(fn)
}

function bootstrapDebug(session, phase, startedAt) {
  if (envValue("AISB_OPENCODE_BOOT_DEBUG") !== "1") return
  const elapsed = typeof startedAt === "number" ? ` elapsed_ms=${Date.now() - startedAt}` : ""
  console.error(`worktree-sandbox bootstrap ${phase} session=${session}${elapsed}`)
}

async function currentBranchAsync(repo) {
  try {
    return await gitOutputAsync(["branch", "--show-current"], repo)
  } catch {
    return ""
  }
}

function warningFromError(error, fallback) {
  return (commandOutput(error?.stdout) || commandOutput(error?.stderr) || error?.message || fallback || "").trim()
}

function initArgs(ctx) {
  return [
    "--repo",
    ctx.repo,
    "--session",
    ctx.session,
    "--worktrees-dir",
    ctx.worktreesDir,
    "--branch-prefix",
    ctx.branchPrefix,
  ]
}

function lifecycleArgs(ctx) {
  return [
    "--repo",
    ctx.repo,
    "--worktrees-dir",
    ctx.worktreesDir,
    "--branch-prefix",
    ctx.branchGlob,
  ]
}

async function runSandboxInit(ctx) {
  return (await execSandboxAsync(ctx.root, "core/cmd/sandbox-init.sh", initArgs(ctx))).trim()
}

async function runSandboxLifecycle(ctx) {
  return execSandboxAsync(ctx.root, "core/cmd/sandbox-lifecycle.sh", lifecycleArgs(ctx))
}

async function prepareSessionContextAsync(sessionID, baseDirectory) {
  const session = sandboxSessionID(sessionID)
  const repo = await resolveRepoAsync(baseDirectory)
  if (!repo) return { session, active: false }

  const branch = await currentBranchAsync(repo)
  if (branch !== "main" && branch !== "master") return { session, active: false }

  const root = await findSandboxRootAsync(repo)
  if (!root) {
    state.warnings.set(session, "installed sandbox core not found")
    return { session, active: false }
  }

  const brPrefix = branchPrefix()
  const common = await resolveGitCommonDirAsync(repo)
  const marker = common ? path.join(common, "sandbox-markers", session) : ""
  return {
    active: true,
    session,
    repo,
    root,
    marker,
    worktreesDir: worktreesDir(repo, root),
    branchPrefix: brPrefix,
    branchGlob: branchGlob(brPrefix),
  }
}

async function createSessionConfigAsync(ctx, entry) {
  let worktree = ""
  let firstWarning = ""

  try {
    const startedAt = Date.now()
    worktree = await runSandboxInit(ctx)
    bootstrapDebug(ctx.session, "init", startedAt)
  } catch (error) {
    firstWarning = warningFromError(error, "sandbox creation failed")

    try {
      const lifecycleStartedAt = Date.now()
      await runSandboxLifecycle(ctx)
      bootstrapDebug(ctx.session, "lifecycle-retry-prepass", lifecycleStartedAt)
    } catch {
      // Lifecycle is only a cleanup pre-pass; sandbox-init retry decides safety.
    }

    try {
      const retryStartedAt = Date.now()
      worktree = await runSandboxInit(ctx)
      bootstrapDebug(ctx.session, "init-retry", retryStartedAt)
    } catch (retryError) {
      const warning = warningFromError(retryError, firstWarning || "sandbox creation failed")
      entry.status = entry.cancelled ? "cancelled" : "failed"
      entry.cfg = emptyConfig()
      if (entry.cancelled) state.bootstraps.delete(ctx.session)
      if (!entry.cancelled) state.warnings.set(ctx.session, warning || "sandbox creation failed")
      return entry.cfg
    }
  }

  if (!worktree) {
    entry.status = entry.cancelled ? "cancelled" : "inactive"
    entry.cfg = emptyConfig()
    if (entry.cancelled) state.bootstraps.delete(ctx.session)
    return entry.cfg
  }

  const cfg = {
    active: true,
    session: ctx.session,
    repo: ctx.repo,
    root: ctx.root,
    worktree,
    marker: ctx.marker,
    worktreesDir: ctx.worktreesDir,
    branchPrefix: ctx.branchPrefix,
    branchGlob: ctx.branchGlob,
    auto: true,
  }

  if (entry.cancelled) {
    await cleanupConfigAsync(cfg)
    entry.status = "cancelled"
    entry.cfg = emptyConfig()
    state.bootstraps.delete(ctx.session)
    return entry.cfg
  }

  entry.status = "ready"
  entry.cfg = cfg
  state.sessions.set(ctx.session, cfg)
  state.currentSession = ctx.session
  state.warnings.delete(ctx.session)
  setProcessEnv(cfg)
  await launchHeartbeatAsync(cfg).catch(() => {
    // Lifecycle TTL still protects sessions if heartbeat launch fails.
  })
  registerProcessCleanup()

  void runSandboxLifecycle(ctx).catch(() => {
    // Post-ready cleanup is best-effort and must not affect the active session.
  })

  return cfg
}

function failBootstrap(entry, session, error) {
  entry.status = entry.cancelled ? "cancelled" : "failed"
  entry.cfg = emptyConfig()
  if (entry.cancelled) state.bootstraps.delete(session)
  if (!entry.cancelled) state.warnings.set(session, warningFromError(error, "sandbox creation failed"))
  return entry.cfg
}

function startBootstrap(entry, raw, baseDirectory) {
  entry.contextPromise = deferBootstrap(async () => {
    const ctx = await prepareSessionContextAsync(raw, baseDirectory)
    if (entry.cancelled) {
      entry.status = "cancelled"
      entry.cfg = emptyConfig()
      state.bootstraps.delete(entry.session)
      return ctx
    }

    if (!ctx.active) {
      entry.status = "inactive"
      entry.enforce = false
      entry.cfg = emptyConfig()
      state.bootstraps.delete(entry.session)
      return ctx
    }

    entry.status = "pending"
    entry.initPromise = createSessionConfigAsync(ctx, entry).catch((error) => failBootstrap(entry, entry.session, error))
    return ctx
  }).catch((error) => {
    failBootstrap(entry, entry.session, error)
    return { session: entry.session, active: false }
  })

  entry.promise = entry.contextPromise.then(async () => {
    if (entry.initPromise) return entry.initPromise
    return entry.cfg || emptyConfig()
  })
  return entry
}

function inactiveBootstrap(session = "") {
  const cfg = emptyConfig()
  return {
    session,
    status: "inactive",
    cfg,
    enforce: false,
    contextPromise: Promise.resolve({ session, active: false }),
    promise: Promise.resolve(cfg),
  }
}

function readyBootstrap(cfg) {
  return {
    session: cfg.session,
    status: "ready",
    cfg,
    enforce: true,
    contextPromise: Promise.resolve({ session: cfg.session, active: true }),
    promise: Promise.resolve(cfg),
  }
}

function bootstrapFor(sessionID, baseDirectory) {
  const raw = sessionID || state.currentSession
  if (!raw || envValue("OPENCODE_SANDBOX_AUTO") === "0") return inactiveBootstrap()

  const session = sandboxSessionID(raw)
  const ready = state.sessions.get(session)
  if (ready) return readyBootstrap(ready)

  const existing = state.bootstraps.get(session)
  if (existing) return existing

  const entry = {
    session,
    status: "preparing",
    cfg: emptyConfig(),
    enforce: true,
    cancelled: false,
    contextPromise: null,
    initPromise: null,
    promise: null,
  }
  state.bootstraps.set(session, entry)
  state.currentSession = session
  return startBootstrap(entry, raw, baseDirectory)
}

function readyConfigFor(sessionID) {
  const raw = sessionID || state.currentSession
  if (!raw) return emptyConfig()
  return state.sessions.get(sandboxSessionID(raw)) || emptyConfig()
}

async function configForTool(sessionID, baseDirectory) {
  const entry = bootstrapFor(sessionID, baseDirectory)
  if (entry.status === "ready") return entry.cfg
  if (entry.status === "inactive" || !entry.enforce) return emptyConfig()

  const cfg = await entry.promise
  if (cfg.active) return cfg

  if (entry.status === "failed" && entry.enforce) {
    const warning = warningFor(entry.session) || "sandbox creation failed"
    throw new Error(`worktree-sandbox: ${warning}`)
  }

  return emptyConfig()
}

function warningFor(sessionID) {
  const session = sandboxSessionID(sessionID || state.currentSession)
  return state.warnings.get(session) || ""
}

function mapPathToSandbox(cfg, file, base) {
  const abs = absolutize(file, base)
  if (!abs || !cfg.active) return abs
  if (isWithin(abs, cfg.worktree)) return abs

  const worktreesBase = path.resolve(cfg.repo, cfg.worktreesDir)
  if (isWithin(abs, worktreesBase)) return abs

  if (isWithin(abs, cfg.repo)) {
    return path.join(cfg.worktree, path.relative(cfg.repo, abs))
  }
  return abs
}

function mapImplicitPathToSandbox(cfg, file, base) {
  const abs = absolutize(file, base)
  if (isExplicitAbsolute(file) && isWithin(abs, cfg.repo) && !isWithin(abs, cfg.worktree)) return abs
  return mapPathToSandbox(cfg, file, base)
}

function mapPatchPath(cfg, file, base) {
  const target = mapImplicitPathToSandbox(cfg, file, base)
  if (isWithin(target, base)) return toPosix(path.relative(base, target)) || "."
  return toPosix(target)
}

function rewritePatch(cfg, patchText, base) {
  return String(patchText || "")
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^(\*\*\* (?:Add File|Update File|Delete File|Move to): )(.+)$/)
      if (!match) return line
      return `${match[1]}${mapPatchPath(cfg, match[2].trim(), base)}`
    })
    .join("\n")
}

function patchTargets(patchText, base) {
  const targets = []
  for (const line of String(patchText || "").split(/\r?\n/)) {
    const match = line.match(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/)
    if (!match) continue
    targets.push(absolutize(match[1].trim(), base))
  }
  return targets
}

function guardPath(cfg, file) {
  if (!cfg.active || !file) return
  const target = absolutize(file, cfg.worktree || cfg.repo)
  if (isWithin(target, cfg.worktree)) return

  if (isWithin(target, cfg.repo)) {
    throw new Error(
      `sandbox-guard: edit blocked - session ${cfg.session} has sandbox at ${cfg.worktree}, but target is in main repo (${target}). Edit the sandbox copy and merge via git.`,
    )
  }
}

function commandMentionsMainRepo(cfg, command) {
  const normalized = toPosix(String(command || "")).toLowerCase()
  const repo = toPosix(cfg.repo).toLowerCase()
  const sandbox = toPosix(cfg.worktree).toLowerCase()
  return normalized.includes(repo) && !normalized.includes(sandbox)
}

function eventSessionID(event) {
  return event?.properties?.sessionID || event?.properties?.info?.id || event?.sessionID || ""
}

function injectShellEnv(cfg, output) {
  output.env.OPENCODE_SANDBOX_ACTIVE = "1"
  output.env.OPENCODE_SANDBOX_SESSION = cfg.session
  output.env.OPENCODE_SANDBOX_REPO = cfg.repo
  output.env.OPENCODE_SANDBOX_ROOT = cfg.root
  output.env.OPENCODE_SANDBOX_WORKTREE = cfg.worktree
  output.env.OPENCODE_SANDBOX_WORKTREES_DIR = cfg.worktreesDir
  output.env.OPENCODE_SANDBOX_BRANCH_PREFIX = cfg.branchPrefix
}

function sandboxToolDefinition(output) {
  const note = [
    "worktree-sandbox is active for this project.",
    "Use OPENCODE_SANDBOX_WORKTREE as the project root for file operations.",
    "Do not target the main repository path directly.",
  ].join(" ")
  if (!output.description || output.description.includes("worktree-sandbox is active")) return
  output.description = `${output.description}\n\n${note}`
}

export const WorktreeSandbox = async ({ directory, worktree }) => {
  const baseDirectory = directory || worktree || process.cwd()

  return {
    event: async ({ event }) => {
      const id = eventSessionID(event)
      if (!id) return

      if (event.type === "session.created" || event.type === "session.updated") {
        bootstrapFor(id, baseDirectory)
        return
      }

      if (event.type === "session.idle" || event.type === "session.status") {
        const entry = bootstrapFor(id, baseDirectory)
        const cfg = entry.status === "ready" ? entry.cfg : readyConfigFor(id)
        if (cfg.active) void touchMarkerAsync(cfg)
        return
      }

      if (event.type === "session.deleted") {
        const session = sandboxSessionID(id)
        const entry = state.bootstraps.get(session)
        if (entry) {
          entry.cancelled = true
          if (entry.status !== "pending" && entry.status !== "preparing") state.bootstraps.delete(session)
        }
        const cfg = state.sessions.get(session)
        if (cfg) void cleanupConfigAsync(cfg)
        state.sessions.delete(session)
        state.warnings.delete(session)
        if (state.currentSession === session) state.currentSession = ""
      }
    },

    "experimental.chat.system.transform": async (input, output) => {
      const entry = bootstrapFor(input?.sessionID, baseDirectory)
      const cfg = entry.status === "ready" ? entry.cfg : readyConfigFor(input?.sessionID)
      const warning = warningFor(input?.sessionID)
      if (!output || !Array.isArray(output.system)) return

      if (cfg.active && cfg.worktree) {
        output.system.push(`worktree-sandbox active. Use this root for all file operations: ${cfg.worktree}`)
        return
      }

      if (entry.status === "preparing") {
        output.system.push(CHECKING_SYSTEM_CONTEXT)
        return
      }

      if (entry.status === "pending") {
        output.system.push(PENDING_SYSTEM_CONTEXT)
        return
      }

      if (warning) output.system.push(`worktree-sandbox warning: ${warning}`)
    },

    "tool.definition": async (input, output) => {
      if (!input || !output || !SANDBOXED_TOOLS.has(input.toolID)) return
      sandboxToolDefinition(output)
    },

    "shell.env": async (input, output) => {
      if (!output || !output.env) return
      const cfg = await configForTool(input?.sessionID, baseDirectory)
      if (!cfg.active) return
      injectShellEnv(cfg, output)
    },

    "tool.execute.before": async (input, output) => {
      if (!input || !output || !SANDBOXED_TOOLS.has(input.tool)) return
      const cfg = await configForTool(input?.sessionID, baseDirectory)
      if (!cfg.active) return

      const args = output.args || {}
      const tool = input.tool
      const cwd = absolutize(args.workdir || baseDirectory, baseDirectory)

      if (PATH_TOOLS.has(tool) && args.filePath) {
        args.filePath = mapImplicitPathToSandbox(cfg, args.filePath, cwd)
        guardPath(cfg, args.filePath)
        return
      }

      if (SEARCH_TOOLS.has(tool)) {
        args.path = args.path ? mapImplicitPathToSandbox(cfg, args.path, baseDirectory) : cfg.worktree
        guardPath(cfg, args.path)
        return
      }

      if (PATCH_TOOLS.has(tool)) {
        args.patchText = rewritePatch(cfg, args.patchText, baseDirectory)
        const targets = patchTargets(args.patchText, baseDirectory)
        if (targets.length === 0) {
          guardPath(cfg, path.join(cfg.worktree, ".__opencode_apply_patch_target__"))
          return
        }
        for (const target of targets) guardPath(cfg, target)
        return
      }

      if (tool === "bash") {
        const nextCwd = args.workdir ? mapImplicitPathToSandbox(cfg, args.workdir, baseDirectory) : cfg.worktree
        args.workdir = nextCwd
        if (commandMentionsMainRepo(cfg, args.command)) {
          throw new Error(
            `sandbox-guard: bash command mentions the main repo (${cfg.repo}). Run it from the sandbox instead: ${cfg.worktree}`,
          )
        }
        guardPath(cfg, path.join(nextCwd, ".__opencode_bash_target__"))
      }
    },
  }
}

export default WorktreeSandbox
