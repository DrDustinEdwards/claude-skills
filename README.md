# claude-skills

Version control for the Claude Code steering layer: the skills and commands that
run on this machine, plus the loop that keeps them current with how the models
actually behave.

## These files are executed, not documented

Every file under `skills/` and `commands/` is loaded by Claude Code and acted on.
**A change here is a behavior change.** It is not a docs edit, it does not wait
for a deploy, and it takes effect in the next session that loads it. Review a
diff here the way you would review a diff to a hook or a CI config, because that
is the category it is in.

That is the whole reason the repo exists. Before it, these files lived only in
`~/.claude/` on one machine, with no history, no diff, and no way to tell when a
rule changed or who changed it.

## Layout

```
skills/<name>/SKILL.md    one skill per directory, loaded by name
commands/<name>.md        slash commands, invoked as /<name>
guides/<model>.md         fetched vendor prompting guides, one per model
guides/_state.json        per-guide url, sha256, fetched_at, changed_at
scripts/model-guides.mjs  fetches the guides, reports which changed
scripts/line-scope.mjs    the refusal rules of model-refresh, as testable code
MANIFEST.json             which files model-refresh may rewrite
test/                     node --test, no network, no secrets
```

`~/.claude/skills` and `~/.claude/commands` are directory junctions onto this
repo, so Claude Code keeps finding them at the paths it expects while git holds
the history. Junctions are directory-only on Windows, which is why the whole
directory is linked rather than each file.

## The model-refresh loop

Vendors change model behavior faster than a prompt library gets reread, so a rule
written to hold down an old model's habit becomes a rule that fights the new one.
The loop closes that gap:

1. `npm run guides` fetches the models overview and each model's prompting guide,
   stores it, and reports which hashes moved. The guide file holds fetched bytes
   only, so its hash is the hash of the document; `fetched_at` lives in
   `_state.json` and does not perturb the hash.
2. A weekly job posts `skills: refresh for <model>` when a hash changed or a new
   model appeared. A run where nothing changed posts nothing.
3. The `model-refresh` skill reads the guide and proposes edits to owned files.
4. It opens a pull request. **Nothing applies without the merge.**

### What it may rewrite, and what it must not

Only model-facing calibration: output formatting, verbosity, update frequency,
effort hints, thinking and tool-call phrasing. Before any edit it asks three
questions, and one no is a refusal:

1. Does anything outside the prompt fail when this line is violated (a hook, a
   gate, a scrubber, a test)? Then it is a gate.
2. Does it govern the assistant's chat responses, rather than a shipped artifact
   (code, copy, commit messages, email, UI text)?
3. Is it free of a ruling's fingerprints (a date, a measurement, a citation)?

`scripts/line-scope.mjs` implements those questions and `test/line-scope.test.mjs`
drives them against real planted lines, including the `foxing` and `recova` em
dash rules, which a formatting guide would otherwise read as fair game and which
are enforced by a hook and a mail scrubber respectively.

The asymmetry is deliberate. A stale calibration line costs a slightly worse
response. A deleted ruling costs a rule nobody notices is gone until the thing it
prevented happens again.

## Why the vendor skills are not owned

22 of the 25 installed skills come from marketplaces or upstream repos
(Cloudflare, Anthropic). They are tracked in `MANIFEST.json` under `vendored` and
`model-refresh` never edits them, for a practical reason: the next upstream
update overwrites a local edit, so a rewrite there reads as a change that took
and did not. Three skills are locally authored and owned: `dustin-workflow`,
`foxing`, `recova`.

## Running it

```
npm test              the full suite, no network
npm run guides        fetch and report what changed
npm run guides:check  report without writing
```
