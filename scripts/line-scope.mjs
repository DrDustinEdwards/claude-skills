// The three questions from skills/model-refresh/SKILL.md, as code.
//
// A skill is a prompt, and a prompt cannot be tested. This module is the part of
// it that can be: the decision about whether a given line is a model-facing
// calibration that a prompting guide has standing over, or a gate, an artifact
// rule, or a ruling that it does not. The skill asks a model to apply these
// questions; this asks them deterministically, so the refusals have a test.
//
// FAIL CLOSED. Anything this cannot place is refused, because the cost of
// leaving a stale calibration line is a slightly worse response, and the cost of
// deleting a ruling is a rule nobody notices is gone.

// Question 1: does something outside the prompt fail when this line is violated?
const ENFORCED = [
  /\bhooks?\b/i, /PostToolUse/, /PreToolUse/, /\bscrubber\b/i, /\bCI\b/, /\bgate[sd]?\b/i,
  /\blinter?\b/i, /\bnpm run \w+/, /\btest\/\S+/, /\bmust return 0\b/i, /\basserts?\b/i,
  /\bfails the build\b/i, /\bblocks? the (push|commit|merge)\b/i, /\bexit(s)? (1|non-zero)\b/i,
];

// Question 2: does it govern a shipped artifact rather than the assistant's own
// chat responses?
const ARTIFACT = [
  /\bcommit message/i, /\bcode\b/i, /\bcopy\b/i, /\bcomments?\b/i, /\bemails?\b/i,
  /\bUI text\b/i, /\buser-facing\b/i, /\bship(s|ped|ping)?\b/i, /\bin the codebase\b/i,
  /\bsource\b/i, /\bPR (title|description)/i, /\bfilenames?\b/i,
];

// Question 3: does it carry a ruling's fingerprints?
const RULING = [
  /\b\d{4}-\d{2}-\d{2}\b/, /\bruled?\b/i, /\bruling\b/i, /\bstanding rule\b/i,
  /\bwithdrawn\b/i, /\bsuperseded\b/i, /\bdecisions\.md\b/, /\bconventions\.md\b/,
  /\bmeasured\b/i, /\bportfolio-wide\b/i, /\bhard rule\b/i, /\bnever\b.{0,40}\bever\b/i,
];

// Positive markers: a line has to actually look like model calibration before it
// is eligible at all. Matching none of these is a refusal, not a pass.
const MODEL_FACING = [
  /\bbullet(s| points?)?\b/i, /\bheaders?\b/i, /\bbold\b/i, /\bmarkdown\b/i, /\blists?\b/i,
  /\bformat(ting)?\b/i, /\bverbos(e|ity)\b/i, /\bconcise\b/i, /\bterse\b/i, /\bpreamble\b/i,
  /\bprogress update/i, /\bbetween tool calls\b/i, /\beffort level/i, /\bthinking\b/i,
  /\btool[- ]call/i, /\bbatch(ing)? .*\btool/i, /\bresponses?\b/i, /\bprose\b/i,
  /\bexplain(ing)? (more|less)\b/i, /\bresponse length\b/i,
];

const any = (patterns, line) => patterns.find((p) => p.test(line));

export function classifyLine(line) {
  const text = String(line);

  // Order matters: a refusal wins over a positive marker, because the lines this
  // exists to protect are exactly the ones that mention formatting AND a hook.
  const enforced = any(ENFORCED, text);
  if (enforced) return { scope: 'refused', question: 1, reason: `enforced outside the prompt (${enforced})` };

  const artifact = any(ARTIFACT, text);
  if (artifact) return { scope: 'refused', question: 2, reason: `governs a shipped artifact (${artifact})` };

  const ruling = any(RULING, text);
  if (ruling) return { scope: 'refused', question: 3, reason: `carries a ruling's fingerprints (${ruling})` };

  const marker = any(MODEL_FACING, text);
  if (marker) return { scope: 'model-facing', reason: `calibration line (${marker})` };

  return { scope: 'refused', question: 0, reason: 'no model-facing marker; fail closed' };
}

// Convenience for the skill's summary table: split a file, classify every line,
// and return both halves. The counts let a caller assert it read something,
// rather than assert zero edits on a file it never parsed.
export function classifyFile(contents) {
  const lines = String(contents).split(/\r?\n/);
  const eligible = [];
  const refused = [];
  lines.forEach((line, i) => {
    if (line.trim() === '') return;
    const verdict = classifyLine(line);
    (verdict.scope === 'model-facing' ? eligible : refused).push({ line: i + 1, text: line, ...verdict });
  });
  return { parsed: lines.length, eligible, refused };
}
