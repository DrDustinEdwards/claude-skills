import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyFile, classifyLine } from '../scripts/line-scope.mjs';

// The two planted lines the job asks for, shaped like the real ones in project
// skills: a hook-enforced rule and a dated ruling that cites where it was made.
const GATE_LINE =
  'A PostToolUse hook scans for trailing whitespace after every file edit. Strip it before you save. This applies to code, comments, copy, and commit messages.';
const RULING_LINE =
  'THE NIGHTLY SUMMARY IS WITHDRAWN, portfolio-wide, 2026-01-15 (decisions.md).';

// A genuine calibration line, of the kind the fable 5.1 guide says to remove.
const MODEL_LINE =
  'Never use bullet points or headers in your responses; keep everything as plain prose.';

test('refuses a gate line', () => {
  const v = classifyLine(GATE_LINE);
  assert.equal(v.scope, 'refused');
  assert.equal(v.question, 1, 'a hook-enforced line is refused at question 1');
});

test('refuses a ruling line', () => {
  const v = classifyLine(RULING_LINE);
  assert.equal(v.scope, 'refused');
  assert.ok(v.question === 3 || v.question === 2, `expected a ruling refusal, got question ${v.question}`);
});

test('accepts a genuine calibration line', () => {
  const v = classifyLine(MODEL_LINE);
  assert.equal(v.scope, 'model-facing');
});

test('a line that mentions formatting AND a hook is still refused', () => {
  // This is the case the ordering exists for. The protected lines are precisely
  // the ones carrying a model-facing word next to an enforcement word.
  const v = classifyLine('Never use bold or bullets in output; the lint gate fails the build if you do.');
  assert.equal(v.scope, 'refused');
  assert.equal(v.question, 1);
});

test('an em dash rule about shipped code is refused even with no hook named', () => {
  const v = classifyLine('Never use em dashes in code, copy, or comments.');
  assert.equal(v.scope, 'refused');
  assert.equal(v.question, 2);
});

test('an unrecognized line fails closed', () => {
  const v = classifyLine('Deploys go through npm run ship and nothing else.');
  assert.equal(v.scope, 'refused');
});

test('planted gate and ruling lines survive a whole-file pass', () => {
  const file = [
    '# workflow',
    '',
    MODEL_LINE,
    '',
    '## 8. No em dashes',
    GATE_LINE,
    '',
    RULING_LINE,
    '',
  ].join('\n');

  const { parsed, eligible, refused } = classifyFile(file);

  // Count check paired with the content check: "0 edits" must not be reachable
  // by parsing 0 lines.
  assert.equal(parsed, 9, 'the file was not parsed');
  assert.ok(eligible.length > 0, 'nothing was classified; the pass did not run');

  const eligibleText = eligible.map((e) => e.text);
  assert.ok(!eligibleText.includes(GATE_LINE), 'the gate line must never be eligible for edit');
  assert.ok(!eligibleText.includes(RULING_LINE), 'the ruling line must never be eligible for edit');
  assert.ok(eligibleText.includes(MODEL_LINE), 'the calibration line should be eligible');

  const refusedText = refused.map((r) => r.text);
  assert.ok(refusedText.includes(GATE_LINE));
  assert.ok(refusedText.includes(RULING_LINE));
});

test('project em dash rules enforced by a hook or a scrubber are both refused', () => {
  const hooked =
    'A PostToolUse hook scans for em dashes (U+2014) after every file edit. Before pushing, grep the app folder for U+2014; the search must return 0 matches.';
  const scrubbed =
    'Never use em dashes in code or copy. Outgoing mail has a scrubber that removes them.';
  assert.equal(classifyLine(hooked).scope, 'refused');
  assert.equal(classifyLine(hooked).question, 1);
  assert.equal(classifyLine(scrubbed).scope, 'refused');
  assert.equal(classifyLine(scrubbed).question, 1);
});
