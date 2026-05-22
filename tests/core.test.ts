import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { git, initRepo, nodeScript, tempDir } from "./helpers.ts"
import { markerIsFresh, markerPath, markerReadInitialHead, markerReadValue, markerSafeId, markerWrite } from "../core/lib/ttl-marker.ts"
import { scanUncommitted } from "../core/lib/scan-uncommitted.ts"
import { spawnWorktrees } from "../core/lib/worktree-spawn.ts"

test("marker helpers preserve contract fields", () => {
  const root = tempDir("marker")
  const common = path.join(root, ".git")
  const marker = markerPath(common, "oc/session:1")
  assert.equal(markerSafeId("oc/session:1"), "oc-session-1")
  assert.ok(marker.endsWith(path.join("worktree-markers", "oc-session-1")))
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

test("worktree init, guard, and merge gate run through TypeScript CLIs", () => {
  const repo = initRepo("core")
  const init = nodeScript("core/cmd/worktree-init.ts", ["--repo", repo, "--session", "oc-core", "--worktrees-dir", ".worktree/worktrees"])
  assert.equal(init.status, 0, init.stderr || init.stdout)
  const worktree = init.stdout.trim()
  assert.ok(fs.existsSync(worktree), worktree)
  assert.ok(fs.existsSync(path.join(repo, ".git", "worktree-markers", "oc-core")))

  const blocked = nodeScript("core/cmd/worktree-guard.ts", ["--repo", repo, "--session", "oc-core", "--file", path.join(repo, "README.md"), "--worktrees-dir", ".worktree/worktrees"])
  assert.equal(blocked.status, 1)
  assert.match(blocked.stdout, /worktree-guard: edit blocked/)

  const allowed = nodeScript("core/cmd/worktree-guard.ts", ["--repo", repo, "--session", "oc-core", "--file", path.join(worktree, "README.md"), "--worktrees-dir", ".worktree/worktrees"])
  assert.equal(allowed.status, 0)

  fs.writeFileSync(path.join(worktree, "dirty.txt"), "dirty\n", "utf8")
  const gate = nodeScript("core/cmd/worktree-merge-gate.ts", ["--worktree", worktree])
  assert.equal(gate.status, 1)
  assert.match(gate.stdout, /worktree-merge-gate: BLOCKED/)

  git(worktree, ["add", "dirty.txt"])
  git(worktree, ["commit", "-m", "add dirty"])
  const cleanGate = nodeScript("core/cmd/worktree-merge-gate.ts", ["--worktree", worktree])
  assert.equal(cleanGate.status, 0, cleanGate.stdout)
})

test("worktree spawn copies staged, unstaged, and untracked non-ignored state", () => {
  const repo = initRepo("spawn-dirty")
  fs.writeFileSync(path.join(repo, "tracked.txt"), "base\n", "utf8")
  fs.writeFileSync(path.join(repo, ".gitignore"), "ignored.log\n", "utf8")
  git(repo, ["add", "tracked.txt", ".gitignore"])
  git(repo, ["commit", "-m", "add tracked"])

  fs.writeFileSync(path.join(repo, "README.md"), "# staged\n", "utf8")
  git(repo, ["add", "README.md"])
  fs.writeFileSync(path.join(repo, "tracked.txt"), "unstaged\n", "utf8")
  fs.writeFileSync(path.join(repo, "untracked.txt"), "untracked\n", "utf8")
  fs.writeFileSync(path.join(repo, "ignored.log"), "ignored\n", "utf8")

  const result = spawnWorktrees({ repo, printOnly: true })
  assert.equal(result.worktrees.length, 1)
  const worktree = result.worktrees[0].path

  assert.equal(fs.readFileSync(path.join(worktree, "README.md"), "utf8").replace(/\r\n/g, "\n"), "# staged\n")
  assert.equal(fs.readFileSync(path.join(worktree, "tracked.txt"), "utf8").replace(/\r\n/g, "\n"), "unstaged\n")
  assert.equal(fs.readFileSync(path.join(worktree, "untracked.txt"), "utf8"), "untracked\n")
  assert.equal(fs.existsSync(path.join(worktree, "ignored.log")), false)

  const staged = git(worktree, ["diff", "--cached", "--name-only"])
  assert.match(staged.stdout, /README\.md/)
  const unstaged = git(worktree, ["diff", "--name-only"])
  assert.match(unstaged.stdout, /tracked\.txt/)
  const untracked = git(worktree, ["ls-files", "--others", "--exclude-standard"])
  assert.match(untracked.stdout, /untracked\.txt/)
})

test("reflection rescue copies markdown sidecar files", () => {
  const repo = initRepo("rescue")
  const branch = "wt-oc-rescue"
  const worktree = path.join(repo, ".worktree", "worktrees", branch)
  fs.mkdirSync(path.join(worktree, ".reinforce", "reflections"), { recursive: true })
  fs.writeFileSync(path.join(worktree, ".reinforce", "reflections", "note.md"), "note\n", "utf8")
  const result = nodeScript("core/cmd/reflection-rescue.ts", ["--repo", repo])
  assert.equal(result.status, 0)
  assert.ok(fs.existsSync(path.join(repo, ".reinforce", "reflections", "note.md")))
  assert.match(result.stdout, /reflection-rescue: rescued=1 deduped=0/)
})
