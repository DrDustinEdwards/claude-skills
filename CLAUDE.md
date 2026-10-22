# CLAUDE.md - claude-skills

The Claude Code steering layer for Dustin's machine: the `model-refresh` skill, the vendor prompting guides it reads, candidate skills, and the ops-guards plugin. Every file under `skills/`, `commands/` and `plugins/` is loaded and acted on, so a change here is a behavior change (README.md). Public repo.

## Rules

- Tests: keep the minimal set (a few browser tests for flows that must never break, one integration test per real behaviour, unit tests only for tricky logic, shared code tested once where it lives), and remove any test that pins design, repeats coverage or has never caught a real mistake, unless it guards a harm that cannot be undone.
- Never commit a key or `.mcp.json`. The personal skills live in the private repo claude-skills-private.
- Work in a worktree or a branch, never in the live clone that `~/.claude/skills` points at. Every change goes through a pull request.

## Commands

- `npm run validate` and `npm test`: what CI runs, with `claude plugin test` in `plugins/ops-guards`.
- `npm run guides`: fetch the prompting guides. `npm run guides:check` reports without writing.
