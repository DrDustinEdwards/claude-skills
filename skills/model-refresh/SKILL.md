---
name: model-refresh
description: Rewrites model-facing lines in this repo's skills and commands to match a named model's prompting guide. Use when a guide in guides/ has changed, when a new model appears, or when asked to refresh the skills for a model. Rewrites calibration only; it never edits a gate, a ruling, or task content.
trigger: "a prompting guide in guides/ changed, a new model appeared, or a refresh of the skills for a named model is requested"
namespaces: ["claude-skills"]
version: 1.0.0
status: live
source: human
termination: "a pull request carries the rewritten calibration lines, or the run reports that no line was in scope"
interface:
  inputs: "a model name and its fetched guide in guides/"
  outputs: "a pull request rewriting model-facing lines in MANIFEST.json's owned files"
---

# model-refresh

Given a model name and its guide, bring this repo's skills and commands back into
line with how that model actually behaves. Vendors change model behavior faster
than a prompt library gets reread, so instructions written to hold down an old
model's habit quietly become instructions that fight the new one.

**These files are executed by Claude Code. A change here is a behavior change, not
a documentation change.** That is why this skill proposes and never applies: it
ends at a pull request, and a human merges it.

## Inputs

- `model`: a slug with a guide in `guides/`, for example `fable-5-1`.
- `guides/<model>.md`: the fetched guide. Read it in full before touching a file.
- `MANIFEST.json`: the files this repo owns and may rewrite. Anything not listed
  is read for context and never edited.

Refuse and stop if the guide is missing, or if `guides/_state.json` has no entry
for the model. Do not fetch it yourself and do not work from memory of what the
guide says: `scripts/model-guides.mjs` is what fetches, and a guide you recalled
is not a guide you read.

## What counts as a model-facing line

In scope, and only this. A line is model-facing when it exists **because of how a
model behaves in chat**, and would be pointless advice to a careful human:

- Output formatting: bullets, bold, headers, lists, quotation marks in responses.
- Verbosity and density: response length, preamble, how much to explain.
- Update frequency: text between tool calls, progress narration.
- Effort hints: which effort level, how long to think.
- Thinking and tool-call phrasing: batching, one call per turn, tool preambles.
- Any habit the guide says the model now does by default, or now does wrong.

## The three questions, asked per line, before any edit

A line is edited only when the answer to **all three** is yes. Any no, or any
uncertainty, is a refusal, and a refusal is a normal outcome rather than a
failure to try.

1. **Does anything outside the prompt fail when this line is violated?** A hook,
   a CI gate, a scrubber, a test, a linter. If yes, it is a gate. Leave it.
2. **Does it govern the assistant's chat responses, rather than a product
   artifact?** Code, copy, commit messages, emails and UI text are artifacts. A
   rule about what ships is not a rule about how the model talks. Leave it.
3. **Is it free of a ruling's fingerprints?** A date, a measurement, a citation,
   a "ruled" or "withdrawn" or "standing rule", a pointer to a decisions
   document. Those mark a decision somebody made for a reason the guide does not
   know about. Leave it.

**Worked example of a line that looks in scope and is not.** `foxing/SKILL.md`
section 8 and `recova/SKILL.md` both say "no em dashes". A formatting guide will
tell you the model no longer overuses them. Both lines still stay: question 1
fails (a PostToolUse hook and a mail scrubber enforce them), and question 2 fails
(they govern shipped code and copy). The guide has no standing over either.

**The asymmetry is deliberate.** Leaving a stale calibration line in place costs
a slightly worse response. Deleting a ruling costs a rule nobody notices is gone
until the thing it prevented happens again. Refuse toward the second.

## Procedure

1. Read `guides/<model>.md` in full. Collect the specific claims it makes about
   behavior, each with the sentence that states it. A claim without a sentence
   you can quote is not a claim you may act on.
2. Read `MANIFEST.json`. For each owned file, read it in full.
3. For each line, ask the three questions. Record every candidate with its
   verdict, including the refusals: the refusals are the evidence the skill is
   working, and they belong in the summary.
4. Apply the edits. Every changed line carries a one-line citation directly above
   it, as an HTML comment so it does not render:

   ```markdown
   <!-- model-refresh fable-5-1: "If your prompt contains anti-formatting language, remove it or replace it with a rule that says when specific formatting is appropriate." -->
   Use lists and bullet points when asked to, or when the content is multifaceted enough that they help with clarity.
   ```

   The comment quotes the guide, names the model, and is the whole justification.
   A changed line without one is a defect: revert it.
5. One branch, `model-refresh/<model>-<yyyy-mm-dd>`. **One commit per skill**, so
   a reviewer can take some and drop others. The message names the skill and the
   behavior, not the intent: `dustin-workflow: allow formatting where it aids clarity`.
6. Open a pull request and stop. **Never merge**, and never push to the default
   branch. The merge is the human gate and it is the only thing that applies any
   of this.

## Output

One table, and the refusals below it:

| skill | lines changed | guide sentence |
| --- | --- | --- |

| file | line | refused because |
| --- | --- | --- |

## What this skill never does

- Never edits a file outside `MANIFEST.json`, including a vendor skill installed
  from a marketplace. An edit there is reverted by the next upstream update, so
  it reads as a change that took and did not.
- Never edits `.claude/settings.json`, any `CLAUDE.md`, or anything under
  `.github/`. Those decide whether the other rules are enforced at all.
- Never edits task content: steps, commands, paths, repo names, gate text.
- Never removes a rule because a guide is silent on it. Silence is not a
  reversal.
- Never merges its own pull request.
