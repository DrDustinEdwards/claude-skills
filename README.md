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
skills/<name>/SKILL.md        one skill per directory, loaded by name
skills/_candidates/<name>/    proposed skills, not loaded (see below)
commands/<name>.md            slash commands, invoked as /<name>
guides/<model>.md             fetched vendor prompting guides, one per model
guides/_state.json            per-guide url, sha256, fetched_at, changed_at
scripts/model-guides.mjs      fetches the guides, reports which changed
scripts/line-scope.mjs        the refusal rules of model-refresh, as testable code
scripts/validate-skills.mjs   refuses a skill missing an L1 field
MANIFEST.json                 which files model-refresh may rewrite, and what is vendored
test/                         node --test, no network, no secrets
```

`~/.claude/skills` and `~/.claude/commands` are directory junctions onto this
repo, so Claude Code keeps finding them at the paths it expects while git holds
the history. Junctions are directory-only on Windows, which is why the whole
directory is linked rather than each file.

## The skill package format

A skill is a directory, and its `SKILL.md` frontmatter is the part a machine
reads. Three levels, and only the first is metadata:

**L1, the frontmatter.** Required on every skill and on every command:

| field | what it carries |
| --- | --- |
| `name` | the directory name, which is how the skill is loaded |
| `description` | what Claude Code matches when it decides to load the skill |
| `trigger` | a short condition a full-text match can hit |
| `namespaces` | the Capsid namespaces it applies to, or `["*"]` |
| `version` | semver |
| `status` | `candidate`, `live`, or `retired` |
| `source` | the attempt id or job id it came out of, or `human` |
| `termination` | how a run knows the skill finished |
| `interface` | `inputs` and `outputs`, so one skill can compose onto another |

`description` and `trigger` are not duplicates and neither one replaces the
other. `description` is prose aimed at the loader's judgement; `trigger` is a
condition aimed at an index. A skill with a good description and no trigger is
findable only by the model that already has it in context.

`termination` is the field that is easy to leave vague and worth not leaving
vague. A skill with no stated end condition is one a run finishes by running out
of things to try, which is not the same as finishing.

**L2, the body.** The instructions themselves, below the frontmatter.

**L3, `checks/` and `scripts/`.** Optional, and they run in the scorer sandbox
and nowhere else. A skill that needs to execute something to prove it worked puts
it here rather than asking the session to run it.

### The validator

`scripts/validate-skills.mjs` refuses any skill missing an L1 field, and it runs
in CI, so a skill that does not carry its metadata cannot merge. It applies to
`skills/_candidates/` on exactly the same terms: a candidate that skips the
format is not a candidate, it is a file.

Vendored skills are validated and never rewritten. That is the one asymmetry in
the format, and the reason is in "Why the vendor skills are not owned" below: the
next upstream update lands on top of whatever was edited locally, so a validator
finding on a vendored skill is a report, not a repair.

## Candidate skills, and how status changes

`skills/_candidates/<name>/` holds skills a driver proposed from one run's
evidence. Nothing there is loaded: Claude Code registers `SKILL.md` one level
below `skills/`, and a candidate sits two levels below, so the loader walks past
it. That is the safety property the directory exists for, and
`skills/_candidates/README.md` has the full contract.

**Status changes only by pull request, and only on evidence recorded in Capsid.**
Promotion moves the directory to `skills/<name>/` and sets `status: live` in the
same commit. Retirement sets `status: retired` in place and deletes nothing.
Neither one is something a session does to its own working copy on the strength
of the skill having worked once, and neither is something the evaluation loop
does on its own: the loop records the evidence, a pull request cites it, a human
merges it. The measurement lives in Capsid; the pull request points at it rather
than restating it.

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

22 of the 26 installed skills come from marketplaces or upstream repos
(Cloudflare, Anthropic). They are tracked in `MANIFEST.json` under `vendored` and
`model-refresh` never edits them, for a practical reason: the next upstream
update overwrites a local edit, so a rewrite there reads as a change that took
and did not. Four skills are locally authored and owned: `dustin-workflow`,
`foxing`, `recova`, `model-refresh`.

The one edit the vendored set did take is its L1 frontmatter, added once when the
package format landed. Expect an upstream update to drop those lines and the
validator to catch it. That is the intended shape of the failure: a clobbered
vendored skill should be loud rather than quiet.

## Running it

```
npm test              the full suite, no network
npm run validate      refuse any skill missing an L1 field
npm run guides        fetch and report what changed
npm run guides:check  report without writing
```
