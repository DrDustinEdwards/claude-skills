---
name: dustin-workflow
description: Personal workflow rules for Dustin's dev environment. Triggers on session start, env var work, deploy verification, Capsid task files, user-facing copy, and architectural decisions. Applies to every project in the portfolio.
trigger: "any session in this portfolio: PowerShell commands, secrets, Capsid task documents, deploy verification, user-facing copy, or an architectural decision"
namespaces: ["*"]
version: 1.1.0
status: live
source: human
termination: "the session's work is verified by the rule that governs it: a green deploy, a read task document, or a surfaced decision"
interface:
  inputs: "the session's task and the repo it runs in"
  outputs: "work that satisfies the portfolio's standing rules"
---

# dustin-workflow
## Personal developer workflow rules for all Claude Code sessions.
## Applies to every project in the portfolio. Loaded globally via user-scope skill.

---

## 1. PowerShell Environment

Dustin's dev environment is Windows with PowerShell. Always use PowerShell-compatible commands.

- `Invoke-WebRequest` not `curl`
- `Select-String` not `grep`
- Quote paths that contain parentheses: `ls "app/(app)/folder/"`
- Path separator is backslash in PowerShell, forward slash in Node/Next.js
- For loops and scripts: use PowerShell syntax, not bash
- Never assume a Unix command works; check first

## 2. Secrets Live in Platform Stores, Never in Chat

Secrets belong to the platform that runs the app, never to the repo or the conversation.

- Vercel apps (legacy Recova): env vars live in Vercel; use the vercel:env-vars skill to manage them
- Cloudflare Workers apps (foxhound, capsid, germomics, bsw, dustinedwards, txasm, foxing): secrets live in `wrangler secret`; local dev uses gitignored `.dev.vars`
- Never read, display, log, or commit the contents of any `.env*` or `.dev.vars` file; if one exists locally, treat it as radioactive
- Never ask Dustin to paste a secret into chat
- If you cannot proceed without a secret, stop and explain exactly what is needed and why; Dustin sets it himself (agent secret writes are classifier-gated anyway)

## 3. Capsid and the Repo: Which One Wins

The repo wins for anything a gate can verify, including the hard rules, gate counts and the current shape of the code, because every gate verifies disk and Capsid cannot be gated. Capsid wins for rulings and reversals, and for the measurements that forced them, because none of that survives in code comments.

- At session start: read `capsid/conventions.md`, then the project namespace's `core.md`, before touching code
- Every substantial task has a task doc (type `task`) in the namespace; read it first before writing a single line
- If the task touches more than a few files, or any money or auth path, write a short spec and get it approved before code. Small tasks skip this. For dustinedwards the spec lives in Capsid; for other projects a spec file in the repo is fine. Do not invent the spec from chat history.
- The task doc defines commit order, constraints, and success criteria; follow it exactly
- If the task doc is ambiguous, surface the ambiguity before starting, not mid-task
- There is no end-of-session write. Sessions READ Capsid and never write it. The seat writes rulings.
- THE END-OF-SESSION EPISODIC IS WITHDRAWN, portfolio-wide, 2026-08-21 (capsid/conventions.md). The ritual
  produced roughly 100 episodics in recova and 49 in dustinedwards, which is what buried the rulings filed
  beside them. `capsid/prompt-session-summary.md` is superseded and carries a notice.
- The `namespaces` tool shows unconsolidated counts; if the project's count is over ~5, run the lint loop before starting new work

## 4. Read Before Write

Always read a file before editing it.

- Never edit from memory, from chat description, or from what you think the file contains
- Read the actual current file first
- This applies even for small changes; the file may have changed since the task was written
- If the file differs significantly from what the task doc describes, stop and report before proceeding

## 5. Deploy Verification

After every push or deploy, verify before reporting success. Never report a task complete without a verified deploy.

**Cloudflare Workers projects** (foxhound, capsid, germomics, bsw, dustinedwards, txasm, foxing):
1. If CI deploys (foxhound): confirm the deploy job is green for the pushed SHA (`gh run list`), not just the verify job
2. **dustinedwards: deploys go through `npm run ship` and nothing else. Never run `wrangler deploy` in that repo.** Ship owns the deploy contract; it lives in rule 16 of that repo's `CLAUDE.md`, and a bare `wrangler deploy` bypasses all of it
3. If deploying directly (bsw and txasm, neither of which has a ship script): `npx wrangler deploy` must report a new Version ID
4. Hit the health or app URL and confirm it responds (for capsid: `/health` returns ok; for apps: the page renders)

**Vercel projects** (legacy Recova, hotfix-only until cutover):
Use the vercel:status skill. If unavailable, fall back to manual MCP check:
- Recova: projectId `prj_aVBQZKczkfkffNC8ATAYqzm83gn3`, teamId `recova1`
1. Call `list_deployments` with the correct projectId and teamId
2. Confirm state is `READY` and SHA matches the commit just pushed
3. If `ERROR`, get build logs immediately and fix before reporting done

## 6. Never Name Claude or Anthropic in User-Facing Copy

In any copy, UI text, email, or user-facing content for any project:

- Never say "Claude", "Anthropic", "GPT", "LLM", or "language model"
- Always say "AI" when referring to AI-generated content or features
- Applies to error messages, tooltips, onboarding copy, email subjects, and admin UI
- Exception: internal admin-only pages where Dustin is the only user
- Exception: dustinedwards.info names its tools on purpose and carries an AI disclosure on /colophon. The rule above is for the products.

## 7. Surface Architectural Decisions

Never make an architectural decision silently mid-task.

If you encounter any of the following, stop and surface it:
- A schema conflict or missing column
- A pattern that does not exist yet in the codebase
- A design decision that affects multiple files or components
- A third-party constraint that blocks the intended approach
- A choice between two meaningfully different implementations

Do not pick silently and proceed. Name the decision and present options with tradeoffs. Then keep working on anything that does not depend on the answer, and build nothing that does until the decision is made.

The cost of a wrong architectural decision discovered after implementation is always higher than the cost of stopping to ask.
