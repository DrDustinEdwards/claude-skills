import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyBlockCommand } from '../scripts/block-command.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = readFileSync(join(REPO, 'commands', 'improve.md'), 'utf8');

// The pair the job asks for, shaped like the two commands in capsid PR #59:
// the same push and pull request, once with the 2026-09-15 `cd` prefix.
const WITHOUT_CD =
  'git push -u origin job/improve-driver-policy-approval && gh pr create --base master --head job/improve-driver-policy-approval --title "Self-approve branch pushes"';
const WITH_CD = `cd C:\\Users\\email\\dev\\claude-skills; ${WITHOUT_CD}`;

test('a block command without cd is self-approvable', () => {
  const v = classifyBlockCommand(WITHOUT_CD);
  assert.equal(v.selfApprovable, true, v.reason);
  assert.deepEqual(v.classes, ['push_branch', 'open_pr']);
});

test('the same command with a cd segment is not', () => {
  const v = classifyBlockCommand(WITH_CD);
  assert.equal(v.selfApprovable, false);
  assert.match(v.reason, /^"cd /);
});

test('a bare branch push is self-approvable', () => {
  assert.equal(classifyBlockCommand('git push -u origin fix/x').selfApprovable, true);
});

test('the never list stays with the human', () => {
  for (const command of [
    'git push -u origin master',
    'git push -u origin main && gh pr create --title x',
    'git push --force -u origin fix/x',
    'git push -f origin fix/x',
    'git push --force-with-lease origin fix/x',
    'git push origin +fix/x',
    'git push origin fix/x:master',
    'git push origin --delete fix/x',
    'gh pr create --title x',
    'git push -u origin fix/x && gh pr merge 7',
    'git push -u origin fix/x && npx wrangler deploy',
    'git push -u origin fix/x && npx wrangler d1 migrations apply db --remote',
    'git push -u origin fix/x && git push -u origin fix/y',
    'git push -u origin $(git branch --show-current)',
    'git push -u origin fix/x | tee out.txt',
    '',
  ]) {
    assert.equal(classifyBlockCommand(command).selfApprovable, false, command);
  }
});

// The rule only protects anything if the skill says it, so the test reads the
// file the driver loads rather than a copy of the sentence.
test('the skill tells the driver to block without a cd segment and resume on the policy', () => {
  assert.match(SKILL, /^4b\. \*\*A BRANCH PUSH AND A PULL REQUEST ARE YOURS TO APPROVE/m);
  assert.match(SKILL, /\*\*No `cd` segment and nothing else in it:\*\*/);
  assert.match(SKILL, /`approved_by_policy: <version>`/);
  assert.match(SKILL, /Never run a command whose resume was refused\./);
  assert.match(SKILL, /^- \*\*Never merge\.\*\*/m, 'merges stay with the seat');
  assert.match(SKILL, /A push to `master` or `main`, a force push, a migration, a deploy, a secret, a workflow file and a merge still end in step 5's `block`/);
});
