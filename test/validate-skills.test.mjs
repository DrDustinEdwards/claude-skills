import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseFrontmatter, validateEntry, validateTree } from '../scripts/validate-skills.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

// A complete L1 block, in the shape the migration actually wrote. Every negative
// case below is this block with one thing taken out or bent, so a failure names
// the field rather than the fixture.
const GOOD = `---
name: example-skill
description: Does the example thing. Use when an example is needed.
trigger: "an example is needed"
namespaces: ["*"]
version: 1.0.0
status: live
source: human
termination: "the example has run and its result is reported"
interface:
  inputs: "an example request"
  outputs: "an example result"
---

# Example

Body.
`;

const skill = (text, over = {}) => validateEntry({
  path: 'skills/example-skill/SKILL.md',
  text,
  kind: 'skill',
  expectedName: 'example-skill',
  ...over,
});

const bend = (from, to) => GOOD.replace(from, to);
const drop = (field) => GOOD.replace(new RegExp(`^${field}:.*\\n`, 'm'), '');

test('a complete L1 block passes', () => {
  const v = skill(GOOD);
  assert.deepEqual(v.errors, []);
  assert.equal(v.ok, true);
});

test('the parser reads each field type back', () => {
  const fm = parseFrontmatter(GOOD).fields;
  assert.equal(fm.name, 'example-skill');
  assert.equal(fm.trigger, 'an example is needed');
  assert.deepEqual(fm.namespaces, ['*']);
  assert.deepEqual(fm.interface, {
    inputs: 'an example request',
    outputs: 'an example result',
  });
});

// The whole point of the validator: one missing field is a refusal, every time.
for (const field of ['name', 'description', 'trigger', 'namespaces', 'version', 'status', 'source', 'termination']) {
  test(`refuses a skill missing ${field}`, () => {
    const v = skill(drop(field));
    assert.equal(v.ok, false, `dropping ${field} should fail`);
    assert.ok(
      v.errors.some((e) => e.includes(field)),
      `expected an error naming ${field}, got ${JSON.stringify(v.errors)}`,
    );
  });
}

test('refuses a skill with no frontmatter at all', () => {
  const v = skill('# Example\n\nBody with no frontmatter.\n');
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /frontmatter/i.test(e)));
});

test('refuses an empty required field rather than counting it as present', () => {
  const v = skill(bend('trigger: "an example is needed"', 'trigger: ""'));
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('trigger')));
});

test('refuses interface without both inputs and outputs', () => {
  const v = skill(GOOD.replace(/^ {2}outputs:.*\n/m, ''));
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('outputs')));
});

test('refuses a version that is not semver', () => {
  assert.equal(skill(bend('version: 1.0.0', 'version: 1.0')).ok, false);
  assert.equal(skill(bend('version: 1.0.0', 'version: v1.0.0')).ok, false);
  assert.equal(skill(bend('version: 1.0.0', 'version: 0.1.0')).ok, true);
});

test('refuses a status outside candidate, live and retired', () => {
  assert.equal(skill(bend('status: live', 'status: draft')).ok, false);
  assert.equal(skill(bend('status: live', 'status: retired')).ok, true);
});

test('refuses a name that does not match its directory', () => {
  const v = skill(bend('name: example-skill', 'name: something-else'));
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /director/i.test(e)));
});

test('refuses an empty namespaces list', () => {
  const v = skill(bend('namespaces: ["*"]', 'namespaces: []'));
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('namespaces')));
});

// The candidate rules. These are the ones that keep an unreviewed skill from
// describing itself as reviewed, so they are worth more than a shape check.
const candidate = (text) => validateEntry({
  path: 'skills/_candidates/example-skill/SKILL.md',
  text,
  kind: 'candidate',
  expectedName: 'example-skill',
});

test('a candidate must say status candidate', () => {
  const v = candidate(bend('status: live', 'status: candidate').replace('source: human', 'source: job_abc123'));
  assert.deepEqual(v.errors, []);
  assert.equal(candidate(GOOD.replace('source: human', 'source: job_abc123')).ok, false);
});

test('a candidate may not claim source human', () => {
  const text = bend('status: live', 'status: candidate');
  const v = candidate(text);
  assert.equal(v.ok, false);
  assert.ok(
    v.errors.some((e) => /source/.test(e)),
    'a candidate exists because a run produced it, so human is not a source it can claim',
  );
});

test('a live directory may not hold status candidate', () => {
  const v = skill(bend('status: live', 'status: candidate'));
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /candidate/.test(e)));
});

// Commands carry the same L1 block but take their name from the filename, so
// requiring a name key there would fail every command in the repo.
test('a command is not required to carry a name key', () => {
  const text = drop('name');
  const v = validateEntry({ path: 'commands/improve.md', text, kind: 'command', expectedName: 'improve' });
  assert.deepEqual(v.errors, []);
});

// Fail closed: the parser refuses what it cannot place rather than passing it.
test('refuses frontmatter the parser cannot place', () => {
  assert.equal(skill(bend('trigger: "an example is needed"', 'trigger: "unterminated')).ok, false);
  assert.equal(skill(bend('termination: "the example has run and its result is reported"', 'termination: |')).ok, false);
  assert.equal(skill(bend('status: live', '  status: live')).ok, false);
});

// The integration case, and the reason this file is worth having: the real tree
// has to pass, or the format is aspirational.
test('every skill and command in the repo validates', () => {
  const report = validateTree(REPO);
  const failures = report.entries.filter((e) => !e.ok);
  assert.deepEqual(
    failures.map((f) => `${f.path}: ${f.errors.join('; ')}`),
    [],
  );
  assert.ok(report.entries.length >= 27, `expected the whole tree, saw ${report.entries.length}`);
  assert.equal(report.ok, true);
});

test('the candidates README is not mistaken for a skill', () => {
  const report = validateTree(REPO);
  assert.ok(
    !report.entries.some((e) => e.path.endsWith('_candidates/README.md')),
    'only <name>/SKILL.md is a skill; the directory README is documentation',
  );
});

test('the vendored set is validated and marked, not skipped', () => {
  const report = validateTree(REPO);
  const wrangler = report.entries.find((e) => e.path === 'skills/wrangler/SKILL.md');
  assert.ok(wrangler, 'a vendored skill must still be validated');
  assert.equal(wrangler.vendored, true, 'and must be reported as vendored so nothing later rewrites it');
  const foxing = report.entries.find((e) => e.path === 'skills/foxing/SKILL.md');
  assert.equal(foxing.vendored, false);
});
