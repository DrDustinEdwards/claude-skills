import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeCommand,
  commandWords,
  deleteTargets,
  absolutePath,
  junctionIn,
  selfIsNodeModules,
  isForcePush,
  isGitCleanIgnored,
  FORCE_PUSH_DENY,
  GIT_CLEAN_X_DENY,
} from '../plugins/ops-guards/hooks/lib/guard.mjs';
import { isHeavy, lockNs, waitMessage } from '../plugins/ops-guards/hooks/lib/heavy.mjs';

const CWD = 'C:\\Users\\email\\dev\\worktrees\\cs-x';

test('force pushes are refused in every spelling', () => {
  const refused = [
    'git push --force origin job/x',
    'git push -f',
    'git push -fu origin job/x',
    'git push --force-with-lease origin job/x',
    'git push --force-if-includes origin job/x',
    'git push origin +job/x:job/x',
    'git -C C:/Users/email/dev/worktrees/cs-x push -f origin job/x',
    'git status && git push --force',
    'bash -c "git push -f origin main"',
    'cmd /c git push --force',
  ];
  for (const c of refused) assert.equal(analyzeCommand(c, CWD).deny, FORCE_PUSH_DENY, c);
});

test('ordinary pushes and pulls pass', () => {
  const allowed = [
    'git push -u origin job/x',
    'git push --set-upstream origin job/x',
    'git -C C:/Users/email/dev/worktrees/cs-x push -u origin job/x',
    'git push origin job/x; gh pr create --repo a/b --title "force push guard"',
    'git pull --force',
    'git log --format=%H -f',
    'echo git push --force',
    'git commit -m "no force push here"',
  ];
  for (const c of allowed) assert.equal(analyzeCommand(c, CWD).deny, undefined, c);
  assert.equal(allowed.length + 10, 18, 'count of commands judged across both tests');
});

test('git clean with -x or -X is refused, git clean -n and -fd are not', () => {
  for (const c of ['git clean -fdx', 'git clean -x', 'git clean -fX', 'git -C C:/w clean -ffdx', 'git clean -d -x -f']) {
    assert.equal(analyzeCommand(c, CWD).deny, GIT_CLEAN_X_DENY, c);
  }
  for (const c of ['git clean -n', 'git clean -fd', 'git clean -nd', 'git clean --dry-run']) {
    assert.equal(analyzeCommand(c, CWD).deny, undefined, c);
  }
  assert.equal(isGitCleanIgnored(['git', 'clean', '-fdx']), true);
});

test('recursive deletes name their targets as absolute paths', () => {
  const t = (c) => commandWords(c).flatMap((w) => deleteTargets(w, CWD));
  assert.deepEqual(t('rm -rf C:/Users/email/dev/worktrees/foo'), ['C:\\Users\\email\\dev\\worktrees\\foo']);
  assert.deepEqual(t('rm -rf /c/Users/email/dev/worktrees/foo'), ['C:\\Users\\email\\dev\\worktrees\\foo']);
  assert.deepEqual(t('rm -rf ./build ../other/dir'), [`${CWD}\\build`, 'C:\\Users\\email\\dev\\worktrees\\other\\dir']);
  assert.deepEqual(t('Remove-Item -Recurse -Force "C:\\w\\wt"'), ['C:\\w\\wt']);
  assert.deepEqual(t('Remove-Item -Path C:\\w\\wt -Recurse'), ['C:\\w\\wt']);
  assert.deepEqual(t('rmdir /s /q C:\\w\\wt'), ['C:\\w\\wt']);
  assert.deepEqual(t('git -C C:/main worktree remove C:/w/wt'), ['C:\\w\\wt']);
  assert.deepEqual(t('git worktree remove --force C:/w/wt'), ['C:\\w\\wt']);
  assert.deepEqual(t('rm -rf C:/w/*'), ['C:\\w'], 'a wildcard inspects the folder above it');
  assert.deepEqual(t('cmd /c "rmdir /s /q C:\\w\\wt"'), ['C:\\w\\wt']);
});

test('deletes that are not recursive, and the safe alternative, name no target', () => {
  const t = (c) => commandWords(c).flatMap((w) => deleteTargets(w, CWD));
  assert.deepEqual(t('rm file.txt'), []);
  assert.deepEqual(t('rm -f file.txt'), []);
  assert.deepEqual(t('rm -Force x.txt'), []);
  assert.deepEqual(t('Remove-Item C:\\w\\file.txt'), []);
  // The refusal message tells the user to run exactly this, so it must stay allowed.
  assert.deepEqual(t('cmd /c rmdir "C:\\w\\wt\\node_modules"'), []);
  assert.deepEqual(t('rmdir C:\\w\\wt\\node_modules'), []);
  assert.equal(analyzeCommand('cmd /c rmdir "C:\\w\\wt\\node_modules"', CWD).probe, undefined);
});

test('a recursive delete is handed back for the junction probe', () => {
  assert.deepEqual(analyzeCommand('rm -rf C:/w/wt && echo done', CWD), { probe: ['C:\\w\\wt'] });
  assert.deepEqual(analyzeCommand('ls', CWD), {});
});

test('absolutePath edge cases', () => {
  assert.equal(absolutePath('$HOME/x', CWD), null);
  assert.equal(absolutePath('\\\\server\\share\\x', CWD), null);
  assert.equal(absolutePath('rel', null), null);
  assert.equal(absolutePath('C:\\', CWD), 'C:\\');
  assert.equal(absolutePath('C:\\a\\..\\b\\.\\c\\', CWD), 'C:\\b\\c');
});

test('the junction probe output is read for a node_modules link', () => {
  assert.equal(junctionIn('C:\\w\\wt\\node_modules\r\nC:\\w\\wt\\other-link\r\n'), 'C:\\w\\wt\\node_modules');
  assert.equal(junctionIn('C:\\w\\wt\\a\\node_modules\n'), 'C:\\w\\wt\\a\\node_modules');
  assert.equal(junctionIn('C:\\w\\wt\\node_modules_backup\n'), null);
  assert.equal(junctionIn(''), null);
  assert.equal(junctionIn(undefined), null);
  assert.equal(selfIsNodeModules('C:\\w\\wt\\node_modules'), true);
  assert.equal(selfIsNodeModules('C:\\w\\wt'), false);
});

test('isForcePush ignores non-push verbs', () => {
  assert.equal(isForcePush(['git', 'fetch', '--force']), false);
  assert.equal(isForcePush(['git', 'push', '-n']), false);
});

test('heavy work is installs and builds, not tests or lint', () => {
  const heavy = [
    'npm ci',
    'npm install',
    'npm i',
    'npm install --no-audit',
    'pnpm install',
    'yarn add left-pad',
    'npm run build',
    'npm run build:prod',
    'yarn build',
    'npx playwright install chromium',
    'npx vite build',
    'cd C:/w/wt && npm ci',
    'git pull; npm install',
    'bash -c "npm ci && npm run build"',
  ];
  const light = [
    'npm test',
    'npm run test',
    'npm run validate',
    'npm run lint',
    'npx playwright test',
    'npx vitest run',
    'git status',
    'node scripts/disk-guard.mjs preflight C:/w 20',
    'echo npm ci',
    'npm run buildtools',
    'npm config get cache',
  ];
  for (const c of heavy) assert.equal(isHeavy(c), true, `heavy: ${c}`);
  for (const c of light) assert.equal(isHeavy(c), false, `light: ${c}`);
  assert.equal(heavy.length + light.length, 25, 'count of commands judged');
});

test('lock names and wait messages', () => {
  assert.equal(lockNs('3f2a9c1e-5b7d-4e8a'), 'tab-3f2a9c1e');
  assert.equal(lockNs(undefined), 'tab-unknown');
  assert.match(waitMessage({ ns: 'tab-1', started: '2026-10-08T00:00:00.000Z' }), /tab-1 since 2026-10-08/);
  assert.match(waitMessage(null), /unknown session/);
});
