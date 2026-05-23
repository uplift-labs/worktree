## Why

Project development needs a consistent planning and review gate so behavior changes, governance updates, and implementation work do not bypass the established OpenSpec process.

This is needed now because repository instructions should make the OpenSpec flow mandatory and agent-enforced instead of optional or dependent on the user remembering to request it.

## What Changes

- Require all project development changes to go through the OpenSpec flow before implementation.
- Instruct agents to proactively enforce OpenSpec when users request project changes.
- Define the appropriate OpenSpec skill path for exploration, proposal, implementation, and archive work.
- Allow the bare `openspec` CLI bash command string in the project OpenCode configuration while leaving argument-bearing invocations on the normal permission path.
- Allow only read-only or higher-priority-instruction exceptions to bypass the flow.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `project-governance`: Make OpenSpec mandatory for project development changes and require agents to drive the flow proactively.

## Impact

- Updates project governance requirements in OpenSpec.
- Updates `AGENTS.md` repository instructions.
- Updates project OpenCode permissions in `opencode.json`.
- No runtime code, CLI contract, adapter behavior, or dependency changes.
