import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The admin exposure check itself lives in the capsid repo
// (scripts/admin-exposure-check.mjs) and is tested there. This file pins what
// this repo owns: that /improve tells the driver to run it first and to fail
// closed, which is what DECIDE 6 of design-local-admin-exposure.md requires.

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = readFileSync(join(REPO, 'commands', 'improve.md'), 'utf8');

const section = () => {
  const start = SKILL.indexOf('**ADMIN EXPOSURE PREFLIGHT');
  assert.notEqual(start, -1, 'improve.md has no ADMIN EXPOSURE PREFLIGHT section');
  return SKILL.slice(start, SKILL.indexOf('**`work all` IS', start));
};

test('the command runs the capsid admin exposure check from the capsid clone', () => {
  const s = section();
  assert.match(s, /node <repo_folders\.capsid>\\scripts\\admin-exposure-check\.mjs --cwd /);
  assert.match(s, /"ok":true/);
});

test('a check that cannot run is a refusal, not a pass', () => {
  const s = section();
  assert.match(s, /Fail closed/);
  assert.match(s, /could not run/);
  assert.match(s, /do not remove the connector or the seat key yourself/i);
});

test('the preflight comes before the key file check and before any claim', () => {
  const at = SKILL.indexOf('**ADMIN EXPOSURE PREFLIGHT');
  const keyCheck = SKILL.indexOf('**BEFORE TOUCHING A NAMESPACE, CONFIRM ITS KEY FILE EXISTS.**');
  const claim = SKILL.indexOf('1. **Claim one job.**');
  assert.ok(at !== -1 && keyCheck !== -1 && claim !== -1, 'a landmark is missing');
  assert.ok(at < keyCheck, 'preflight must precede the key file check');
  assert.ok(at < claim, 'preflight must precede the claim step');
});
