import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { git, initRepo, nodeScript, tempDir } from "./helpers.ts"
import { markerIsFresh, markerPath, markerReadInitialHead, markerReadValue, markerSafeId, markerWrite } from "../core/lib/ttl-marker.ts"
import { scanUncommitted } from "../core/lib/scan-uncommitted.ts"

test("marker helpers preserve contract fields", () => {
  const root = tempDir("marker")
  const common = path.join(root, ".git")
  const marker = markerPath(common, "oc/session:1")
  assert.equal(markerSafeId("oc/session:1"), "oc-session-1")
  assert.ok(marker.endsWith(path.join("sandbox-markers", "oc-session-1")))
  assert.equal(markerWrite(marker, "wt-oc-session-1", "abc123"), true)
  assert.equal(markerReadValue(marker), "wt-oc-session-1")
  assert.equal(markerReadInitialHead(marker), "abc123")
  assert.equal(markerIsFresh(marker, 60), true)
})

test("scanUncommitted counts tracked and untracked files", () => {
  const repo = initRepo("scan")
  assert.equal(scanUncommitted(repo).clean, true)
  fs.writeFileSync(path.join(repo, "README.md"), "changed\n", "utf8")
  fs.writeFileSync(path.join(repo, "new.txt"), "new\n", "utf8")
  const scan = scanUncommitted(repo)
  assert.equal(scan.clean, false)
  assert.match(scan.summary, /1 modified, 1 untracked/)
})

test("sandbox init, guard, and merge gate run through TypeScript CLIs", () => {
  const repo = initRepo("core")
  const init = nodeScript("core/cmd/sandbox-init.ts", ["--repo", repo, "--session", "oc-core", "--worktrees-dir", ".sandbox/worktrees"])
  assert.equal(init.status, 0, init.stderr || init.stdout)
  const worktree = init.stdout.trim()
  assert.ok(fs.existsSync(worktree), worktree)
  assert.ok(fs.existsSync(path.join(repo, ".git", "sandbox-markers", "oc-core")))

  const blocked = nodeScript("core/cmd/sandbox-guard.ts", ["--repo", repo, "--session", "oc-core", "--file", path.join(repo, "README.md"), "--worktrees-dir", ".sandbox/worktrees"])
  assert.equal(blocked.status, 1)
  assert.match(blocked.stdout, /sandbox-guard: edit blocked/)

  const allowed = nodeScript("core/cmd/sandbox-guard.ts", ["--repo", repo, "--session", "oc-core", "--file", path.join(worktree, "README.md"), "--worktrees-dir", ".sandbox/worktrees"])
  assert.equal(allowed.status, 0)

  fs.writeFileSync(path.join(worktree, "dirty.txt"), "dirty\n", "utf8")
  const gate = nodeScript("core/cmd/sandbox-merge-gate.ts", ["--worktree", worktree])
  assert.equal(gate.status, 1)
  assert.match(gate.stdout, /sandbox-merge-gate: BLOCKED/)

  git(worktree, ["add", "dirty.txt"])
  git(worktree, ["commit", "-m", "add dirty"])
  const cleanGate = nodeScript("core/cmd/sandbox-merge-gate.ts", ["--worktree", worktree])
  assert.equal(cleanGate.status, 0, cleanGate.stdout)
})

test("reflection rescue copies markdown sidecar files", () => {
  const repo = initRepo("rescue")
  const branch = "wt-oc-rescue"
  const worktree = path.join(repo, ".sandbox", "worktrees", branch)
  fs.mkdirSync(path.join(worktree, ".reinforce", "reflections"), { recursive: true })
  fs.writeFileSync(path.join(worktree, ".reinforce", "reflections", "note.md"), "note\n", "utf8")
  const result = nodeScript("core/cmd/reflection-rescue.ts", ["--repo", repo])
  assert.equal(result.status, 0)
  assert.ok(fs.existsSync(path.join(repo, ".reinforce", "reflections", "note.md")))
  assert.match(result.stdout, /reflection-rescue: rescued=1 deduped=0/)
})
