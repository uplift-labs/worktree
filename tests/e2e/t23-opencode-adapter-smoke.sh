#!/bin/bash
# t23 — OpenCode adapter plugin smoke test.
set -u
SELF="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SELF/../.." && pwd)"
. "$ROOT/tests/lib/assert.sh"
. "$ROOT/tests/lib/fixture.sh"

fixture_init
trap fixture_cleanup EXIT

REPO=$(fixture_repo "t23")

echo "== plugin auto-creates session sandbox and guards tools =="
if grep -q 'execFileSync' "$ROOT/adapters/opencode/plugins/worktree-sandbox.js" 2>/dev/null; then
  assert_exit "OpenCode runtime plugin has no sync child_process calls" 0 1
else
  assert_exit "OpenCode runtime plugin has no sync child_process calls" 0 0
fi
if grep -Eq 'resolveSandboxWorktree\(|shouldRenderSandboxFiles\(' "$ROOT/adapters/opencode/tui/worktree-sandbox-branch.tsx" 2>/dev/null; then
  assert_exit "OpenCode TUI render path uses async sandbox resolution" 0 1
else
  assert_exit "OpenCode TUI render path uses async sandbox resolution" 0 0
fi
if grep -q 'tool.execute.after' "$ROOT/adapters/opencode/tui/worktree-sandbox-branch.tsx" 2>/dev/null; then
  assert_exit "OpenCode TUI subscribes only to bus events" 0 1
else
  assert_exit "OpenCode TUI subscribes only to bus events" 0 0
fi
if grep -q 'session.next.tool.success' "$ROOT/adapters/opencode/tui/worktree-sandbox-branch.tsx" 2>/dev/null && \
   grep -q 'file.edited' "$ROOT/adapters/opencode/tui/worktree-sandbox-branch.tsx" 2>/dev/null; then
  assert_exit "OpenCode TUI includes documented refresh events" 0 0
else
  assert_exit "OpenCode TUI includes documented refresh events" 0 1
fi

if command -v node >/dev/null 2>&1; then
  NODE_ASYNC_SCRIPT="$FIXTURE_ROOT/opencode-plugin-async-smoke.mjs"
  cat > "$NODE_ASYNC_SCRIPT" <<'JS'
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const [pluginPath, repo, fakeRoot] = process.argv.slice(2)
const sessionID = "oc-asyncboot"
const sandbox = path.join(repo, ".sandbox", "worktrees", `wt-${sessionID}`)
const marker = path.join(repo, ".git", "sandbox-markers", sessionID)

function posix(value) {
  return String(value || "").replace(/\\/g, "/")
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(predicate, timeoutMs, label) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await sleep(50)
  }
  throw new Error(`timed out waiting for ${label}`)
}

function writeExecutable(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  fs.chmodSync(file, 0o755)
}

writeExecutable(
  path.join(fakeRoot, "core", "cmd", "sandbox-init.sh"),
  `#!/bin/bash
set -u
REPO=""; SESSION=""; WT_DIR=".sandbox/worktrees"; BR_PREFIX="wt"
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --session) SESSION="$2"; shift 2 ;;
    --worktrees-dir) WT_DIR="$2"; shift 2 ;;
    --branch-prefix) BR_PREFIX="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf 'init\n' >> "$REPO/.git/sandbox-init-count"
sleep 1
BRANCH="$BR_PREFIX-$SESSION"
WT_PATH="$REPO/$WT_DIR/$BRANCH"
MARKER="$REPO/.git/sandbox-markers/$SESSION"
mkdir -p "$WT_PATH" "$(dirname "$MARKER")"
HEAD=$(git -C "$REPO" rev-parse HEAD 2>/dev/null || true)
printf '%s %s %s' "$BRANCH" "$(date +%s)" "$HEAD" > "$MARKER"
printf '%s\n' "$WT_PATH"
`,
)
writeExecutable(path.join(fakeRoot, "core", "cmd", "sandbox-lifecycle.sh"), "#!/bin/bash\nexit 0\n")
writeExecutable(
  path.join(fakeRoot, "core", "cmd", "sandbox-cleanup.sh"),
  `#!/bin/bash
set -u
REPO=""; SESSION=""; WT_DIR=".sandbox/worktrees"
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --session) SESSION="$2"; shift 2 ;;
    --worktrees-dir) WT_DIR="$2"; shift 2 ;;
    *) shift ;;
  esac
done
sleep 1
rm -rf "$REPO/$WT_DIR/wt-$SESSION"
rm -f "$REPO/.git/sandbox-markers/$SESSION" "$REPO/.git/sandbox-markers/$SESSION.hb"
`,
)
writeExecutable(path.join(fakeRoot, "core", "cmd", "sandbox-guard.sh"), "#!/bin/bash\nexit 0\n")
writeExecutable(path.join(fakeRoot, "core", "lib", "heartbeat.sh"), "#!/bin/bash\nexit 0\n")

for (const key of [
  "OPENCODE_SANDBOX_ACTIVE",
  "OPENCODE_SANDBOX_SOURCE",
  "OPENCODE_SANDBOX_SESSION",
  "OPENCODE_SANDBOX_REPO",
  "OPENCODE_SANDBOX_WORKTREE",
  "OPENCODE_SANDBOX_WORKTREES_DIR",
  "OPENCODE_SANDBOX_BRANCH_PREFIX",
]) {
  delete process.env[key]
}
process.env.OPENCODE_SANDBOX_ROOT = fakeRoot

const mod = await import(pathToFileURL(pluginPath).href)
if (!mod.default || mod.default.id !== "uplift.worktree-sandbox" || typeof mod.default.server !== "function") {
  throw new Error("default export is not a stable OpenCode plugin object")
}
if (typeof mod.WorktreeSandbox !== "function") throw new Error("named WorktreeSandbox export missing")
const logs = []
const client = { app: { async log(request) { logs.push(request.body) } } }
const hooks = await mod.default.server({ directory: repo, worktree: repo, client })

let started = Date.now()
await hooks.event({ event: { type: "session.created", properties: { sessionID } } })
if (Date.now() - started > 300) throw new Error("session.created blocked on sandbox init")

const system = { system: [] }
started = Date.now()
await hooks["experimental.chat.system.transform"]({ sessionID, model: {} }, system)
if (Date.now() - started > 300) throw new Error("system transform blocked on sandbox init")
if (!/(checking whether this session needs a sandbox|preparing a sandbox)/.test(system.system.join("\n"))) {
  throw new Error("non-blocking sandbox system context missing")
}
if (fs.existsSync(sandbox)) throw new Error("sandbox was created before the async barrier")

const write = { args: { filePath: "created.txt" } }
const secondWrite = { args: { filePath: "second.txt" } }
started = Date.now()
await Promise.all([
  hooks["tool.execute.before"]({ tool: "write", sessionID, callID: "async-write" }, write),
  hooks["tool.execute.before"]({ tool: "write", sessionID, callID: "async-write-2" }, secondWrite),
])
const waited = Date.now() - started
if (waited < 800) throw new Error(`tool did not wait for pending sandbox init: ${waited}ms`)
if (posix(write.args.filePath) !== posix(path.join(sandbox, "created.txt"))) {
  throw new Error(`write target was not mapped into async sandbox: ${write.args.filePath}`)
}
if (posix(secondWrite.args.filePath) !== posix(path.join(sandbox, "second.txt"))) {
  throw new Error(`second write target was not mapped into async sandbox: ${secondWrite.args.filePath}`)
}
const initCount = fs.readFileSync(path.join(repo, ".git", "sandbox-init-count"), "utf8").trim().split(/\n/).filter(Boolean).length
if (initCount !== 1) throw new Error(`async bootstrap was not single-flight: ${initCount}`)
if (!fs.existsSync(marker)) throw new Error("async sandbox marker missing after tool wait")
if (!logs.some((item) => item.service === "worktree-sandbox" && item.message === "sandbox ready" && posix(item.extra?.worktree) === posix(sandbox))) {
  throw new Error("structured sandbox ready log missing")
}

const shell = { env: {} }
await hooks["shell.env"]({ sessionID, cwd: repo }, shell)
if (posix(shell.env.OPENCODE_SANDBOX_WORKTREE) !== posix(sandbox)) throw new Error("shell env missing async sandbox")

started = Date.now()
await hooks.event({ event: { type: "session.deleted", properties: { sessionID } } })
if (Date.now() - started > 300) throw new Error("session.deleted blocked on sandbox cleanup")
await waitFor(() => !fs.existsSync(sandbox) && !fs.existsSync(marker), 3000, "async sandbox cleanup")

const cancelSessionID = "oc-cancelboot"
const cancelSandbox = path.join(repo, ".sandbox", "worktrees", `wt-${cancelSessionID}`)
const cancelMarker = path.join(repo, ".git", "sandbox-markers", cancelSessionID)
await hooks.event({ event: { type: "session.created", properties: { sessionID: cancelSessionID } } })
await hooks.event({ event: { type: "session.deleted", properties: { sessionID: cancelSessionID } } })
await new Promise((resolve) => setTimeout(resolve, 1500))
if (fs.existsSync(cancelSandbox)) throw new Error("cancelled pending sandbox leaked after late init")
if (fs.existsSync(cancelMarker)) throw new Error("cancelled pending marker leaked after late init")
JS
  OUT=$(node "$NODE_ASYNC_SCRIPT" "$ROOT/adapters/opencode/plugins/worktree-sandbox.js" "$REPO" "$FIXTURE_ROOT/fake-opencode-core" 2>&1)
  ec=$?
  assert_exit "plugin async bootstrap smoke exits 0" 0 "$ec"

  NODE_FAIL_SCRIPT="$FIXTURE_ROOT/opencode-plugin-bootstrap-fail.mjs"
  cat > "$NODE_FAIL_SCRIPT" <<'JS'
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const [pluginPath, repo, fakeRoot] = process.argv.slice(2)
const sessionID = "oc-initfail"

function writeExecutable(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  fs.chmodSync(file, 0o755)
}

writeExecutable(path.join(fakeRoot, "core", "cmd", "sandbox-init.sh"), "#!/bin/bash\nprintf 'init exploded' >&2\nexit 1\n")
writeExecutable(path.join(fakeRoot, "core", "cmd", "sandbox-lifecycle.sh"), "#!/bin/bash\nexit 0\n")
writeExecutable(path.join(fakeRoot, "core", "cmd", "sandbox-cleanup.sh"), "#!/bin/bash\nexit 0\n")
writeExecutable(path.join(fakeRoot, "core", "cmd", "sandbox-guard.sh"), "#!/bin/bash\nexit 0\n")
writeExecutable(path.join(fakeRoot, "core", "lib", "heartbeat.sh"), "#!/bin/bash\nexit 0\n")

for (const key of [
  "OPENCODE_SANDBOX_ACTIVE",
  "OPENCODE_SANDBOX_SOURCE",
  "OPENCODE_SANDBOX_SESSION",
  "OPENCODE_SANDBOX_REPO",
  "OPENCODE_SANDBOX_WORKTREE",
  "OPENCODE_SANDBOX_WORKTREES_DIR",
  "OPENCODE_SANDBOX_BRANCH_PREFIX",
]) {
  delete process.env[key]
}
process.env.OPENCODE_SANDBOX_ROOT = fakeRoot

const mod = await import(pathToFileURL(pluginPath).href)
const logs = []
const client = { app: { async log(request) { logs.push(request.body) } } }
const hooks = await mod.WorktreeSandbox({ directory: repo, worktree: repo, client })
let denied = false
try {
  await hooks["tool.execute.before"]({ tool: "write", sessionID, callID: "fail-write" }, { args: { filePath: "should-not-write.txt" } })
} catch (error) {
  denied = String(error.message).includes("init exploded")
}
if (!denied) throw new Error("write-capable tool did not fail closed after sandbox init failure")
if (!logs.some((item) => item.service === "worktree-sandbox" && item.message === "sandbox bootstrap failed" && /init exploded/.test(item.extra?.warning || ""))) {
  throw new Error("structured bootstrap failure log missing")
}
JS
  OUT=$(node "$NODE_FAIL_SCRIPT" "$ROOT/adapters/opencode/plugins/worktree-sandbox.js" "$REPO" "$FIXTURE_ROOT/fake-opencode-fail-core" 2>&1)
  ec=$?
  assert_exit "plugin bootstrap failure fails closed" 0 "$ec"

  NODE_AUTO_SCRIPT="$FIXTURE_ROOT/opencode-plugin-auto-smoke.mjs"
  cat > "$NODE_AUTO_SCRIPT" <<'JS'
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const [pluginPath, repo] = process.argv.slice(2)
const sessionID = "ses_21536e3b0ffeOW9vISvPpKcGG0"
const compactSessionID = "oc-21536e3b0ffe"
const sandbox = path.join(repo, ".sandbox", "worktrees", `wt-${compactSessionID}`)
const marker = path.join(repo, ".git", "sandbox-markers", compactSessionID)

function posix(value) {
  return String(value || "").replace(/\\/g, "/")
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(predicate, timeoutMs, label) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await sleep(50)
  }
  throw new Error(`timed out waiting for ${label}`)
}

for (const key of [
  "OPENCODE_SANDBOX_ACTIVE",
  "OPENCODE_SANDBOX_SOURCE",
  "OPENCODE_SANDBOX_SESSION",
  "OPENCODE_SANDBOX_REPO",
  "OPENCODE_SANDBOX_ROOT",
  "OPENCODE_SANDBOX_WORKTREE",
  "OPENCODE_SANDBOX_WORKTREES_DIR",
  "OPENCODE_SANDBOX_BRANCH_PREFIX",
]) {
  delete process.env[key]
}

const mod = await import(pathToFileURL(pluginPath).href)
const logs = []
const client = { app: { async log(request) { logs.push(request.body) } } }
const hooks = await mod.WorktreeSandbox({ directory: repo, worktree: repo, client })

await hooks.event({ event: { type: "session.created", properties: { sessionID } } })

const definition = { description: "Run commands" }
await hooks["tool.definition"]({ toolID: "bash" }, definition)
if (!definition.description.includes("worktree-sandbox is active")) throw new Error("tool definition missing sandbox note")

const relativeWrite = { args: { filePath: "created.txt" } }
await hooks["tool.execute.before"]({ tool: "write", sessionID, callID: "relative-write" }, relativeWrite)
if (posix(relativeWrite.args.filePath) !== posix(path.join(sandbox, "created.txt"))) {
  throw new Error(`relative write was not mapped into sandbox: ${relativeWrite.args.filePath}`)
}
if (!fs.existsSync(sandbox)) throw new Error(`sandbox missing: ${sandbox}`)
if (!fs.existsSync(marker)) throw new Error(`marker missing: ${marker}`)

const system = { system: [] }
await hooks["experimental.chat.system.transform"]({ sessionID, model: {} }, system)
if (!posix(system.system.join("\n")).includes(posix(sandbox))) throw new Error("system prompt missing sandbox root")

const shell = { env: {} }
await hooks["shell.env"]({ sessionID, cwd: repo }, shell)
if (shell.env.OPENCODE_SANDBOX_SESSION !== compactSessionID) throw new Error("shell env uses long sandbox session")
if (posix(shell.env.OPENCODE_SANDBOX_WORKTREE) !== posix(sandbox)) throw new Error("shell env missing sandbox")

let deniedWrite = false
try {
  await hooks["tool.execute.before"](
    { tool: "write", sessionID, callID: "main-write" },
    { args: { filePath: path.join(repo, "README.md") } },
  )
} catch (error) {
  deniedWrite = String(error.message).includes("sandbox-guard")
}
if (!deniedWrite) throw new Error("absolute write to main repo was not denied")
if (!logs.some((item) => item.message === "blocked main repo target" && item.extra?.tool === "write")) {
  throw new Error("structured path block log missing")
}

const grep = { args: { pattern: "README" } }
await hooks["tool.execute.before"]({ tool: "grep", sessionID, callID: "grep" }, grep)
if (posix(grep.args.path) !== posix(sandbox)) throw new Error(`grep default path was not sandbox: ${grep.args.path}`)

const patch = {
  args: {
    patchText: "*** Begin Patch\n*** Add File: auto-patch.txt\n+hello\n*** End Patch",
  },
}
await hooks["tool.execute.before"]({ tool: "apply_patch", sessionID, callID: "patch" }, patch)
if (!posix(patch.args.patchText).includes(".sandbox/worktrees/wt-oc-21536e3b0ffe/auto-patch.txt")) {
  throw new Error(`patch path was not mapped into sandbox: ${patch.args.patchText}`)
}

const bashDefault = { args: { command: "git status", description: "Shows git status" } }
await hooks["tool.execute.before"]({ tool: "bash", sessionID, callID: "bash-default" }, bashDefault)
if (posix(bashDefault.args.workdir) !== posix(sandbox)) throw new Error(`bash default workdir was not sandbox: ${bashDefault.args.workdir}`)

let deniedBash = false
try {
  await hooks["tool.execute.before"](
    { tool: "bash", sessionID, callID: "bash-main" },
    { args: { command: "touch README.md", workdir: repo, description: "Touches file" } },
  )
} catch (error) {
  deniedBash = String(error.message).includes("sandbox-guard")
}
if (!deniedBash) throw new Error("bash from main repo was not denied")
if (!logs.some((item) => item.message === "blocked main repo target" && item.extra?.tool === "bash" && item.extra?.callID === "bash-main")) {
  throw new Error("structured bash block log missing")
}

await hooks.event({ event: { type: "session.deleted", properties: { info: { id: sessionID } } } })
await waitFor(() => !fs.existsSync(sandbox) && !fs.existsSync(marker), 10000, "empty auto sandbox cleanup")
JS
  OUT=$(node "$NODE_AUTO_SCRIPT" "$ROOT/adapters/opencode/plugins/worktree-sandbox.js" "$REPO" 2>&1)
  ec=$?
  [ "$ec" -eq 0 ] || printf '  GOT: %s\n' "$OUT" >&2
  assert_exit "plugin auto sandbox smoke exits 0" 0 "$ec"
  assert_not_contains "plugin auto sandbox does not write TUI-noisy stderr" "\[sandbox\]" "$OUT"

  echo "== TUI branch watcher refreshes on HEAD changes and polling fallback =="
  WATCH_REPO=$(fixture_repo "t23-branch-watch")
  WATCH_WT=$(fixture_worktree "$WATCH_REPO" "watch-start" "watch.txt" "one")
  NODE_BRANCH_SCRIPT="$FIXTURE_ROOT/opencode-branch-watch.mjs"
  cat > "$NODE_BRANCH_SCRIPT" <<'JS'
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"

const [corePath, worktree] = process.argv.slice(2)
const core = await import(pathToFileURL(corePath).href)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(predicate, timeoutMs, label) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await sleep(50)
  }
  throw new Error(`timed out waiting for ${label}`)
}

const watchUpdates = []
const watched = core.createBranchObserver({
  getWorktree: () => worktree,
  env: { AISB_OPENCODE_BRANCH_REFRESH_MS: "10000" },
  debounceMs: 50,
  onChange: (update) => watchUpdates.push(update),
})

await waitFor(() => watchUpdates.some((item) => item.branch === "watch-start"), 2000, "initial watched branch")
if (!watched.status().watcherActive) throw new Error("HEAD watcher did not start")

execFileSync("git", ["-C", worktree, "switch", "-c", "watch-next"], { stdio: "ignore" })
await waitFor(() => watchUpdates.some((item) => item.branch === "watch-next"), 5000, "watched branch switch")
watched.close()
if (watched.status().watcherActive) throw new Error("HEAD watcher stayed active after close")

const pollUpdates = []
const polled = core.createBranchObserver({
  getWorktree: () => worktree,
  env: {
    AISB_OPENCODE_BRANCH_WATCH: "0",
    AISB_OPENCODE_BRANCH_REFRESH_MS: "200",
  },
  debounceMs: 50,
  onChange: (update) => pollUpdates.push(update),
})

await waitFor(() => pollUpdates.some((item) => item.branch === "watch-next"), 2000, "initial polled branch")
if (polled.status().watcherActive) throw new Error("watcher started despite AISB_OPENCODE_BRANCH_WATCH=0")

execFileSync("git", ["-C", worktree, "switch", "-c", "poll-next"], { stdio: "ignore" })
await waitFor(() => pollUpdates.some((item) => item.branch === "poll-next"), 5000, "polled branch switch")
polled.close()

let resolveSlowWorktree
let slowWorktreeRequested = false
const slowWorktree = new Promise((resolve) => {
  resolveSlowWorktree = resolve
})
const closedUpdates = []
const closing = core.createBranchObserver({
  getWorktree() {
    slowWorktreeRequested = true
    return slowWorktree
  },
  debounceMs: 50,
  onChange: (update) => closedUpdates.push(update),
})
const refreshPromise = closing.refresh("close-race")
await waitFor(() => slowWorktreeRequested, 1000, "branch refresh entered async getWorktree")
closing.close()
resolveSlowWorktree(worktree)
await refreshPromise
await sleep(100)
if (closedUpdates.length !== 0) throw new Error("closed branch observer emitted an update after async refresh")
if (closing.status().watcherActive) throw new Error("closed branch observer created watcher after async refresh")
JS
  OUT=$(node "$NODE_BRANCH_SCRIPT" "$ROOT/adapters/opencode/tui/worktree-sandbox-branch-core.js" "$WATCH_WT" 2>&1)
  ec=$?
  assert_exit "TUI branch watcher smoke exits 0" 0 "$ec"

  echo "== TUI sandbox sidebar diff reads worktree changes =="
  DIFF_REPO=$(fixture_repo "t23-sidebar-diff")
  DIFF_WT=$(fixture_worktree "$DIFF_REPO" "diff-start" "tracked.txt" "one")
  printf 'main\n' > "$DIFF_REPO/main-only.txt"
  git -C "$DIFF_REPO" add main-only.txt
  git -C "$DIFF_REPO" commit -q -m "feat: main-only change"
  git -C "$DIFF_WT" merge -q --no-edit main
  printf 'committed\n' >> "$DIFF_WT/README.md"
  git -C "$DIFF_WT" add README.md
  git -C "$DIFF_WT" commit -q -m "feat: committed sandbox change"
  printf 'working\n' >> "$DIFF_WT/tracked.txt"
  printf 'free\n' > "$DIFF_WT/free.txt"
  printf 'dirty main\n' > "$DIFF_REPO/main-dirty.txt"
  MANUAL_WT="$DIFF_REPO/.uplift/sandbox/worktrees/wt-opencode-manual"
  mkdir -p "$(dirname "$MANUAL_WT")"
  git -C "$DIFF_REPO" worktree add -q "$MANUAL_WT" -b wt-opencode-manual

  NODE_DIFF_SCRIPT="$FIXTURE_ROOT/opencode-sidebar-diff.mjs"
  cat > "$NODE_DIFF_SCRIPT" <<'JS'
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const [corePath, worktree, manualWorktree] = process.argv.slice(2)
const core = await import(pathToFileURL(corePath).href)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(predicate, timeoutMs, label) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await sleep(50)
  }
  throw new Error(`timed out waiting for ${label}`)
}

function names(files) {
  return files.map((item) => item.file)
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key)
}

const files = core.readSandboxChangedFiles(worktree)
const initialNames = names(files)
for (const expected of ["README.md", "tracked.txt", "free.txt"]) {
  if (!initialNames.includes(expected)) throw new Error(`missing changed file: ${expected}`)
}
for (const unexpected of ["main-only.txt", "main-dirty.txt"]) {
  if (initialNames.includes(unexpected)) throw new Error(`main repo change leaked into sandbox list: ${unexpected}`)
}

const readme = files.find((item) => item.file === "README.md")
if (!readme || readme.additions < 1) throw new Error("committed diff additions were not counted")

const asyncFiles = await core.readSandboxChangedFilesAsync(worktree)
const asyncNames = names(asyncFiles)
for (const expected of ["README.md", "tracked.txt", "free.txt"]) {
  if (!asyncNames.includes(expected)) throw new Error(`async changed files missing: ${expected}`)
}

const manualResolved = core.resolveSandboxWorktree({ directory: manualWorktree, env: {} })
if (path.resolve(manualResolved) !== path.resolve(manualWorktree)) {
  throw new Error(`manual sandbox worktree was not inferred: ${manualResolved}`)
}
if (core.shouldRenderSandboxFiles({ directory: manualWorktree, env: {} })) {
  throw new Error("custom sandbox files sidebar should not render when OpenCode already runs in the sandbox worktree")
}
if (!core.shouldRenderSandboxFiles({
  directory: path.dirname(worktree),
  env: {
    OPENCODE_SANDBOX_ACTIVE: "1",
    OPENCODE_SANDBOX_WORKTREE: worktree,
  },
})) {
  throw new Error("custom sandbox files sidebar should render when OpenCode runs outside the sandbox worktree")
}

const updates = []
const defaultObserver = core.createChangedFilesObserver({
  getWorktree: () => worktree,
  debounceMs: 50,
  onChange: (update) => updates.push(update),
})

await waitFor(() => updates.some((update) => names(update.files).includes("free.txt")), 2000, "initial sidebar diff")
if (defaultObserver.status().pollMs !== 2000) throw new Error("files observer should poll by default")
fs.writeFileSync(path.join(worktree, "default-poll.txt"), "default poll\n")
await waitFor(() => updates.some((update) => names(update.files).includes("default-poll.txt")), 5000, "default polled sidebar diff")
defaultObserver.close()
updates.length = 0

const optOutObserver = core.createChangedFilesObserver({
  getWorktree: () => worktree,
  env: { AISB_OPENCODE_FILES_REFRESH_MS: "0" },
  debounceMs: 50,
  onChange: (update) => updates.push(update),
})

await waitFor(() => updates.some((update) => names(update.files).includes("default-poll.txt")), 2000, "initial sidebar diff with polling disabled")
if (optOutObserver.status().pollMs !== 0) throw new Error("files observer did not honor disabled polling")
optOutObserver.close()
updates.length = 0

const observer = core.createChangedFilesObserver({
  getWorktree: () => worktree,
  env: { AISB_OPENCODE_FILES_REFRESH_MS: "200" },
  debounceMs: 50,
  onChange: (update) => updates.push(update),
})

await waitFor(() => updates.some((update) => names(update.files).includes("free.txt")), 2000, "initial sidebar diff")
fs.writeFileSync(path.join(worktree, "another.txt"), "another\n")
await waitFor(() => updates.some((update) => names(update.files).includes("another.txt")), 3000, "updated sidebar diff")
if (observer.status().pollMs !== 200) throw new Error("files observer did not use configured poll interval")
observer.close()

const sandboxPluginPath = path.join(worktree, ".opencode", "tui-plugins", "worktree-sandbox-branch.tsx")
const parentPluginPath = path.join(path.dirname(worktree), "parent", "worktree-sandbox-branch.tsx")
fs.mkdirSync(path.dirname(sandboxPluginPath), { recursive: true })
fs.mkdirSync(path.dirname(parentPluginPath), { recursive: true })
fs.writeFileSync(sandboxPluginPath, "sandbox plugin\n")
fs.writeFileSync(parentPluginPath, "parent plugin\n")
const sandboxPluginURL = pathToFileURL(sandboxPluginPath).href
const parentPluginURL = pathToFileURL(parentPluginPath).href
if (core.tuiPluginID(sandboxPluginURL) === core.tuiPluginID(parentPluginURL)) {
  throw new Error("TUI plugin ids should be path-scoped")
}
const sandboxEnv = {
  OPENCODE_SANDBOX_ACTIVE: "1",
  OPENCODE_SANDBOX_WORKTREE: worktree,
}
if (!core.shouldRunTuiPlugin(sandboxPluginURL, { directory: worktree, env: sandboxEnv })) {
  throw new Error("sandbox-local TUI plugin should run in sandbox worktree")
}
if (core.shouldRunTuiPlugin(parentPluginURL, { directory: worktree, env: sandboxEnv })) {
  throw new Error("parent TUI plugin should no-op when sandbox copy is loaded")
}
if (!core.shouldRunTuiPlugin(parentPluginURL, { directory: path.dirname(worktree), env: sandboxEnv })) {
  throw new Error("parent TUI plugin should still run outside sandbox worktree")
}
fs.rmSync(path.dirname(sandboxPluginPath), { recursive: true, force: true })
if (!core.shouldRunTuiPlugin(parentPluginURL, { directory: worktree, env: sandboxEnv })) {
  throw new Error("parent TUI plugin should run when sandbox copy is absent")
}
if (!(await core.shouldRunTuiPluginAsync(parentPluginURL, { directory: worktree, env: sandboxEnv }))) {
  throw new Error("async parent TUI plugin check should run when sandbox copy is absent")
}
if (!(await core.shouldRenderSandboxFilesAsync({
  directory: path.dirname(worktree),
  env: {
    OPENCODE_SANDBOX_ACTIVE: "1",
    OPENCODE_SANDBOX_WORKTREE: worktree,
  },
}))) {
  throw new Error("async custom sandbox files sidebar should render outside sandbox worktree")
}

const pluginID = "internal:sidebar-files"
let pluginActive = true
let pluginEnabled = true
const calls = []
const kv = {}
const fakeApi = {
  kv: {
    get(key, fallback) {
      return hasOwn(kv, key) ? kv[key] : fallback
    },
    set(key, value) {
      kv[key] = value
    },
  },
  plugins: {
    list() {
      return [{ id: pluginID, enabled: pluginEnabled, active: pluginActive }]
    },
    async deactivate(id) {
      calls.push(`deactivate:${id}`)
      pluginActive = false
      kv.plugin_enabled = { ...(kv.plugin_enabled || {}), [id]: false }
      return true
    },
    async activate(id) {
      calls.push(`activate:${id}`)
      pluginActive = true
      pluginEnabled = true
      kv.plugin_enabled = { ...(kv.plugin_enabled || {}), [id]: true }
      return true
    },
  },
}

const release = core.acquireBuiltinFilesHidden(fakeApi)
await waitFor(() => calls.includes(`deactivate:${pluginID}`), 2000, "built-in files deactivation")
if (pluginActive) throw new Error("built-in files plugin stayed active")
if (!core.builtinFilesHiddenStatus().hidden) throw new Error("hidden status was not tracked")
if (hasOwn(kv.plugin_enabled, pluginID)) throw new Error("built-in files disabled state leaked into KV")

release()
await waitFor(() => calls.includes(`activate:${pluginID}`), 2000, "built-in files restoration")
if (!pluginActive) throw new Error("built-in files plugin was not restored")
if (core.builtinFilesHiddenStatus().hidden) throw new Error("hidden status stayed enabled after release")
if (hasOwn(kv.plugin_enabled, pluginID)) throw new Error("built-in files restored state leaked into KV")

calls.length = 0
pluginActive = false
pluginEnabled = false
const releaseInactive = core.acquireBuiltinFilesHidden(fakeApi)
await sleep(100)
releaseInactive()
await sleep(100)
if (calls.length !== 0) throw new Error("inactive/user-disabled built-in files plugin was toggled")
JS
  OUT=$(node "$NODE_DIFF_SCRIPT" "$ROOT/adapters/opencode/tui/worktree-sandbox-branch-core.js" "$DIFF_WT" "$MANUAL_WT" 2>&1)
  ec=$?
  assert_exit "TUI sandbox sidebar diff smoke exits 0" 0 "$ec"
else
  echo "node not found; skipping plugin import smoke"
fi

test_summary
