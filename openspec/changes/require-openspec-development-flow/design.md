## Context

Project governance currently identifies OpenSpec as the planning and behavior-specification layer for non-trivial changes. The new policy makes that flow mandatory for all project development changes and requires agents to initiate the correct OpenSpec step instead of waiting for the user to ask.

## Goals / Non-Goals

**Goals:**

- Make OpenSpec the required entry point for project development changes.
- Keep the rule actionable by naming the OpenSpec skills to use for exploration, proposal, implementation, and archive work.
- Allow the bare `openspec` CLI bash command string without approval prompts in this project.
- Preserve practical exceptions for informational and read-only work.

**Non-Goals:**

- Add runtime enforcement in code or hooks.
- Change CLI behavior, exit codes, lifecycle behavior, or adapter contracts.
- Replace the existing verification and finish-loop rules.

## Decisions

- Express the policy in `AGENTS.md` so OpenCode agents receive it as repository instruction context. This is lighter than adding runtime tooling because the requested behavior is agent workflow governance.
- Update the `project-governance` spec so the policy is tracked as an OpenSpec requirement rather than only as prose in `AGENTS.md`.
- Add a project-local OpenCode `permission.bash` allow rule for the bare `openspec` command string. Argument-bearing invocations remain on the normal permission path because wildcard command-string rules can also match chained shell commands.
- Treat read-only investigation, review, and purely informational requests as outside the mandatory proposal path because they do not change the project.

## Risks / Trade-offs

- Instruction-based enforcement is not a hard technical gate -> Mitigation: make the wording explicit and require agents to pause direct edits when no OpenSpec change exists.
- Overhead for small changes -> Mitigation: keep the flow mandatory but allow read-only and informational requests to proceed without proposal artifacts.
- Bash allow patterns are string matches, not shell parsing -> Mitigation: only auto-allow the exact bare `openspec` command string and keep argument-bearing invocations subject to the normal permission flow.
