# Candidate skills

Where a driver writes a skill it has just learned, before anyone has agreed it
works. Nothing here is loaded, and nothing here is trusted.

## Why the extra directory level is the safety mechanism

`~/.claude/skills` is a junction onto this repo's `skills/`, and Claude Code
registers a skill by finding `SKILL.md` one level down. A candidate lives at
`skills/_candidates/<name>/SKILL.md`, which is two levels down, so the loader
walks straight past it. `_candidates/` itself holds no `SKILL.md`, so it does
not register as a skill named `_candidates` either.

That is deliberate. A candidate is a proposal a machine wrote from one run's
evidence. If it loaded on write, a skill nobody reviewed would start steering
sessions the moment a driver invented it, and the review step below would be
decoration.

## The layout is the same one live skills use

A candidate is an ordinary skill directory and the validator holds it to the
same L1 frontmatter as everything under `skills/`. The only differences are
where it sits and what its `status` and `source` say:

```yaml
---
name: <kebab-case-name>
description: <what it does and when to load it, in the shape Claude Code matches>
trigger: "<a short condition an FTS match can hit>"
namespaces: ["<ns>"]
version: 0.1.0
status: candidate
source: <the attempt id or job id this came out of>
termination: "<how a run knows the skill finished>"
interface:
  inputs: "<what it needs>"
  outputs: "<what it produces>"
---
```

`source` is the part that earns a candidate its review. `human` is not a valid
source here: a candidate exists because a run produced it, so the attempt or job
id that produced it is what a reviewer follows back to the evidence.

`checks/` and `scripts/` beside `SKILL.md` are L3. They run in the scorer
sandbox and nowhere else.

## Status changes only by pull request

There are three transitions and none of them happen in place on a working copy:

- **Promote.** A pull request moves `skills/_candidates/<name>/` to
  `skills/<name>/` and sets `status: live`. The move and the status change are
  the same commit, so a live status never describes a directory the loader
  cannot see, and the reverse never happens either.
- **Retire.** A pull request sets `status: retired` where the skill already is.
  Retiring does not delete: the record of what was tried and stopped working is
  the point, and a deleted directory takes its `source` with it.
- **Revise.** A pull request bumps `version` under semver.

The evidence for any of these lives in Capsid, not in the pull request body. The
pull request cites it; it does not restate it. A promotion whose only argument is
that the skill looks reasonable is a promotion with no evidence behind it.
