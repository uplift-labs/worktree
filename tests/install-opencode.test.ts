import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"
import { initRepo, nodeScript, projectRoot, readJson } from "./helpers.ts"

test("install copies TypeScript core and OpenCode plugins", () => {
  const repo = initRepo("install")
  const result = nodeScript("install.ts", ["--target", repo])
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.ok(fs.existsSync(path.join(repo, ".opencode", "worktree", "core", "cmd", "worktree-init.ts")))
  assert.ok(fs.existsSync(path.join(repo, ".opencode", "worktree", "core", "lib", "ttl-marker.ts")))
  assert.ok(fs.existsSync(path.join(repo, ".opencode", "worktree", "adapters", "opencode", "plugins", "worktree.ts")))
  assert.ok(fs.existsSync(path.join(repo, ".opencode", "worktree", "adapters", "opencode", "tui", "worktree-branch-core.ts")))
  assert.ok(fs.existsSync(path.join(repo, ".opencode", "plugins", "worktree.ts")))
  assert.ok(!fs.existsSync(path.join(repo, ".opencode", "plugins", "worktree.js")))
  const tuiConfig = readJson(path.join(repo, ".opencode", "tui.json"))
  assert.deepEqual(tuiConfig.plugin, ["./tui-plugins/worktree-branch.tsx"])
})

test("install merges OpenCode options without Python", () => {
  const repo = initRepo("install-options")
  fs.writeFileSync(path.join(repo, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: ["existing-plugin"], permission: { bash: { "git status*": "allow" } } }, null, 2), "utf8")
  const result = nodeScript("install.ts", ["--target", repo, "--with-opencode-permissions", "--with-opencode-os-sandbox"])
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const cfg = readJson(path.join(repo, "opencode.json"))
  assert.ok(cfg.plugin.includes("existing-plugin"))
  assert.ok(cfg.plugin.includes("opencode-sandbox"))
  assert.equal(cfg.permission.external_directory, "ask")
  assert.equal(cfg.permission.doom_loop, "ask")
  assert.equal(cfg.permission.read["*.env"], "deny")
  assert.equal(cfg.permission.read["*.env.example"], "allow")
  assert.equal(cfg.permission.bash["git reset --hard*"], "deny")
})

test("OpenCode TypeScript plugin modules are importable", async () => {
  const plugin = await import(pathToFileURL(path.join(projectRoot, "adapters", "opencode", "plugins", "worktree.ts")).href)
  assert.equal(plugin.WORKTREE_PLUGIN_ID, "uplift.worktree")
  assert.equal(plugin.default.id, "uplift.worktree")
  assert.equal(typeof plugin.default.server, "function")

  const core = await import(pathToFileURL(path.join(projectRoot, "adapters", "opencode", "tui", "worktree-branch-core.ts")).href)
  assert.equal(typeof core.tuiPluginID, "function")
  assert.equal(typeof core.resolveWorktreeAsync, "function")
})
