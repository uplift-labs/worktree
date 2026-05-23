# Semantic Code Intelligence

## Default

OpenCode LSP is enabled through `opencode.json`.

Use LSP first for:

- diagnostics
- definitions
- references
- symbol lookup before edits

## Worktree Rule

During OpenCode sessions, `OPENCODE_WORKTREE_PATH` is the active project root. Semantic tools must operate inside that path and must not target the main checkout directly.

The worktree plugin already routes the built-in `lsp` tool with the other path-aware OpenCode tools.

## Serena And MCP

Serena or other MCP semantic tools are not enabled by default in this repository.

Do not enable write-capable MCP tools until a worktree-aware guard proves every mutating target stays inside `OPENCODE_WORKTREE_PATH`. If a mutating MCP tool does not expose explicit target paths, treat it as unsafe for automatic use.
