# AGENTS.md

This repository also uses `CLAUDE.md`; follow it together with these agent-facing rules.

## Finish Loop

- After making repository changes, dogfood before reporting completion: run the relevant test/install/verification cycle for the touched area, and state the exact commands and results.
- For the full test suite on Windows/Git Bash, run `tests/run.sh` with a timeout of at least `900000` ms. `300000` ms is too short and causes avoidable reruns.
- When the user asks to land, ship, upload, or fix changes in `main`, complete the full path without another reminder: verify, commit, fast-forward or merge `main` as appropriate, push the updated `main`, then dogfood the installed/current state again when feasible.
- Do not leave completed work only in a sandbox branch unless the user explicitly asks for a sandbox-only change or a blocker prevents landing. If blocked, report the blocker and the safest next command.
