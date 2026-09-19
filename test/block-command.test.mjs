import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyBlockCommand } from '../scripts/block-command.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = readFileSync(join(REPO, 'commands', 'improve.md'), 'utf8');

// The pair the job asks for, in the shape gates.md v3 accepts: the tree rides in
// `git -C` and the repo in `--repo`, so neither command depends on a cwd, and the
// two are separated by `;` because the host is Windows.
const WORKTREE = 'C:\\Users\\email\\dev\\claude-skills';
const WITHOUT_CD =
  `git -C ${WORKTREE} push -u origin job/improve-driver-policy-approval; gh pr create --repo DrDustinEdwards/claude-skills --base master --head job/improve-driver-policy-approval --title "Self-approve branch pushes"`;
const WITH_CD = `cd ${WORKTREE}; ${WITHOUT_CD}`;

test('a block command without cd is self-approvable', () => {
  const v = classifyBlockCommand(WITHOUT_CD);
  assert.equal(v.selfApprovable, true, v.reason);
  assert.deepEqual(v.classes, ['push_branch', 'open_pr']);
});

// The colon in a Windows drive letter must not read as a refspec, which it would
// if the -C path were left in the push's arguments.
test('a -C worktree path does not read as a refspec', () => {
  const v = classifyBlockCommand(`git -C ${WORKTREE} push -u origin fix/x`);
  assert.equal(v.selfApprovable, true, v.reason);
  assert.deepEqual(v.classes, ['push_branch']);
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
    'git -C C:\\Users\\email\\dev\\claude-skills push -u origin master',
    'git -C C:\\Users\\email\\dev\\claude-skills push --force -u origin fix/x',
    'git -C C:\\Users\\email\\dev\\claude-skills status',
    'git -C',
    '',
  ]) {
    assert.equal(classifyBlockCommand(command).selfApprovable, false, command);
  }
});

// The rule only protects anything if the skill says it, so the test reads the
// file the driver loads rather than a copy of the sentence.
test('the skill tells the driver to block without a cd segment and resume on the policy', () => {
  assert.match(SKILL, /^4b\. \*\*A BRANCH PUSH AND A PULL REQUEST ARE YOURS TO APPROVE/m);
  assert.match(SKILL, /\*\*NO `cd` SEGMENT ANYWHERE:\*\*/);
  assert.match(SKILL, /The push is `git -C <worktree> push -u origin <branch>`/);
  assert.match(SKILL, /`gh pr create --repo <owner>\/<repo> --base <default> --head <branch>/);
  assert.match(SKILL, /separated by `;`/, 'the host is Windows');
  assert.doesNotMatch(SKILL, /`&& gh pr create/, 'no && separator survives in a block command');
  assert.match(SKILL, /`approved_by_policy: <version>`/);
  assert.match(
    SKILL,
    /`push_branch` and `open_pr`, are the whole of what you may approve, and you block for the human exactly when the command is neither/,
    'self-approval is the two classes, and only the rest goes to a human',
  );
  assert.match(SKILL, /Never run a command whose resume was refused\./);
  assert.match(SKILL, /^- \*\*Never merge\.\*\*/m, 'merges stay with the seat');
  assert.match(SKILL, /A push to `master` or `main`, a force push, a migration, a deploy, a secret, a workflow file and a merge still end in step 5's `block`/);
});

// Every driver but capsid's is scoped to its own namespace, so the version has to
// come from a call the driver can actually make. Measured 2026-09-18: reading
// capsid/policy/gates.md as agent:claude-skills-driver is refused as out of scope,
// while improve_status for its own namespace serves policies.gates.version.
test('the skill takes the gates version from improve_status, not from the capsid document', () => {
  assert.doesNotMatch(SKILL, /`read` `capsid\/policy\/gates\.md`/);
  assert.match(SKILL, /Call `improve_status` with `namespace: <ns>` and read `policies\.gates`/);
  assert.match(SKILL, /reports a `reason` in place of a version, or its `enabled` is false/);
});
