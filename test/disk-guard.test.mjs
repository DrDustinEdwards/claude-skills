import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { preflight, classifyWorktree, planCleanup, applyPlan, inspectWorktree } from '../scripts/disk-guard.mjs';

const GB = 1024 ** 3;
const fakeStatfs = (gb) => () => ({ bavail: gb, bsize: GB });

test('a planted low-disk value stops the claim', () => {
  const v = preflight('C:\\', 20, fakeStatfs(5));
  assert.equal(v.ok, false);
  assert.match(v.reason, /5 GB free.*below the 20 GB minimum/);
});

test('enough free disk passes, and the threshold is the caller\'s setting', () => {
  assert.equal(preflight('C:\\', 20, fakeStatfs(25)).ok, true);
  assert.equal(preflight('C:\\', 30, fakeStatfs(25)).ok, false);
});

test('a free-space reading that cannot be taken stops the claim', () => {
  const v = preflight('C:\\nope', 20, () => {
    throw new Error('ENOENT');
  });
  assert.equal(v.ok, false);
  assert.match(v.reason, /could not read free space/);
});

test('classification table', () => {
  const clean = { dirty: false, unpushed: 0 };
  assert.equal(classifyWorktree({ ...clean, prState: 'MERGED' }).action, 'remove');
  assert.equal(classifyWorktree({ ...clean, prState: 'CLOSED' }).action, 'remove');
  assert.equal(classifyWorktree({ ...clean, prState: 'OPEN' }).action, 'strip');
  assert.equal(classifyWorktree({ ...clean, prState: 'NONE' }).action, 'keep');
  assert.equal(classifyWorktree({ ...clean, prState: 'UNKNOWN' }).action, 'keep-listed');
  assert.equal(classifyWorktree({ dirty: true, unpushed: 0, prState: 'MERGED' }).action, 'keep-listed');
  assert.equal(classifyWorktree({ dirty: false, unpushed: 2, prState: 'MERGED' }).action, 'keep-listed');
  assert.equal(classifyWorktree({ prState: 'MERGED' }).action, 'keep-listed');
});

// Real git: a bare origin, a main clone, and three linked worktrees whose
// branches all have a merged pull request (faked: no network in tests).
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'disk-guard-')));
  const origin = join(base, 'origin.git');
  const main = join(base, 'main');
  const root = join(base, 'worktrees');
  mkdirSync(root);
  git(base, 'init', '--bare', '-b', 'master', origin);
  git(base, 'clone', origin, main);
  git(main, 'config', 'user.email', 't@example.com');
  git(main, 'config', 'user.name', 't');
  writeFileSync(join(main, 'a.txt'), 'a');
  writeFileSync(join(main, '.gitignore'), 'node_modules/\n');
  git(main, 'add', 'a.txt', '.gitignore');
  git(main, 'commit', '-m', 'init');
  git(main, 'push', '-u', 'origin', 'master');
  for (const name of ['pushed', 'dirty', 'unpushed']) {
    git(main, 'worktree', 'add', '-b', `job/${name}`, join(root, name), 'origin/master');
    git(join(root, name), 'config', 'user.email', 't@example.com');
    git(join(root, name), 'config', 'user.name', 't');
    mkdirSync(join(root, name, 'node_modules'));
    writeFileSync(join(root, name, 'node_modules', 'x.js'), 'x');
  }
  writeFileSync(join(root, 'stray-file.log'), 'not a worktree');
  // pushed: a commit that origin has.
  writeFileSync(join(root, 'pushed', 'b.txt'), 'b');
  git(join(root, 'pushed'), 'add', 'b.txt');
  git(join(root, 'pushed'), 'commit', '-m', 'pushed');
  git(join(root, 'pushed'), 'push', '-u', 'origin', 'job/pushed');
  // dirty: an uncommitted file.
  writeFileSync(join(root, 'dirty', 'wip.txt'), 'wip');
  // unpushed: a commit no remote has.
  writeFileSync(join(root, 'unpushed', 'c.txt'), 'c');
  git(join(root, 'unpushed'), 'add', 'c.txt');
  git(join(root, 'unpushed'), 'commit', '-m', 'local only');
  return { root, main };
}

const mergedExec = (cmd, args, cwd) => {
  if (cmd === 'gh') return JSON.stringify([{ state: 'MERGED', number: 1 }]);
  if (args.includes('get-url')) return 'https://github.com/example/repo.git';
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
};

test('a worktree with unpushed or uncommitted work survives cleanup; a pushed one is removed', () => {
  const { root, main } = fixture();
  const plan = planCleanup(root, (dir) => inspectWorktree(dir, mergedExec));
  const byName = Object.fromEntries(plan.map((w) => [w.dir.split(/[\\/]/).pop(), w.action]));
  assert.deepEqual(byName, { pushed: 'remove', dirty: 'keep-listed', unpushed: 'keep-listed' });
  assert.equal(plan.length, 3, 'three worktrees read; the stray file is not one');

  const results = applyPlan(plan);
  assert.ok(results.every((r) => r.done), JSON.stringify(results));
  assert.equal(existsSync(join(root, 'pushed')), false, 'the pushed worktree is gone');
  assert.equal(existsSync(join(root, 'dirty', 'wip.txt')), true, 'uncommitted work survives');
  assert.equal(existsSync(join(root, 'dirty', 'node_modules')), true, 'a kept worktree keeps its node_modules');
  assert.equal(existsSync(join(root, 'unpushed', 'c.txt')), true, 'unpushed work survives');
  assert.doesNotMatch(git(main, 'worktree', 'list'), /job\/pushed/, 'pruned from git');
});

test('an open pull request strips node_modules and keeps the worktree', () => {
  const { root } = fixture();
  const openExec = (cmd, args, cwd) => (cmd === 'gh' ? JSON.stringify([{ state: 'OPEN', number: 2 }]) : mergedExec(cmd, args, cwd));
  const plan = planCleanup(root, (dir) => inspectWorktree(dir, openExec));
  const pushed = plan.find((w) => w.dir.endsWith('pushed'));
  assert.equal(pushed.action, 'strip');
  applyPlan(plan);
  assert.equal(existsSync(join(root, 'pushed')), true);
  assert.equal(existsSync(join(root, 'pushed', 'node_modules')), false);
});

test('improve.md names the script and the setting', async () => {
  const { readFileSync } = await import('node:fs');
  const skill = readFileSync(new URL('../commands/improve.md', import.meta.url), 'utf8');
  assert.match(skill, /scripts\\disk-guard\.mjs|scripts\/disk-guard\.mjs/);
  assert.match(skill, /min_free_gb/);
});
