import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { acquire, release, wait, readLock, DEFAULT_LOCK, STALE_MS } from '../plugins/ops-guards/hooks/lock.mjs';

// The scheduler's lock, from capsid scripts/overnight-guard.mjs (read 2026-10-08):
//   path ~/.capsid/overnight-heavy.lock, created "wx", body JSON { ns, pid, started },
//   stale after 9 hours or when unreadable, released only by the holder's ns.
// These tests pin this port to that behavior, so a tab and the scheduler share one lock.

const here = dirname(fileURLToPath(import.meta.url));
const LOCK_SCRIPT = join(here, '..', 'plugins', 'ops-guards', 'hooks', 'lock.mjs');
const lockPath = () => join(mkdtempSync(join(tmpdir(), 'ops-lock-')), 'nested', 'overnight-heavy.lock');
const at = (iso) => () => Date.parse(iso);

test('the default path and stale window are the scheduler\'s', () => {
  assert.equal(DEFAULT_LOCK, join(homedir(), '.capsid', 'overnight-heavy.lock'));
  assert.equal(STALE_MS, 9 * 3_600_000);
});

test('acquire writes the scheduler\'s JSON, and creates the folder', () => {
  const p = lockPath();
  const info = { ns: 'tab-abc', pid: 4242, started: '2026-10-08T01:00:00.000Z' };
  assert.deepEqual(acquire(p, info), { ok: true });
  const body = JSON.parse(readFileSync(p, 'utf8'));
  assert.deepEqual(body, info);
  assert.equal(typeof body.ns, 'string');
  assert.equal(typeof body.started, 'string');
  assert.ok(!Number.isNaN(Date.parse(body.started)));
  assert.deepEqual(readLock(p), info, 'the reader the scheduler uses accepts it');
});

test('a second acquire is refused and names the holder', () => {
  const p = lockPath();
  const first = { ns: 'tab-a', pid: 1, started: '2026-10-08T01:00:00.000Z' };
  acquire(p, first);
  const second = acquire(p, { ns: 'tab-b', pid: 2, started: '2026-10-08T01:05:00.000Z' }, { now: at('2026-10-08T01:10:00.000Z') });
  assert.deepEqual(second, { ok: false, holder: first });
  assert.equal(readLock(p).ns, 'tab-a', 'the holder is untouched');
});

test('release works only for the holder', () => {
  const p = lockPath();
  acquire(p, { ns: 'tab-a', pid: 1, started: '2026-10-08T01:00:00.000Z' });
  assert.equal(release(p, 'tab-b').released, false);
  assert.ok(existsSync(p), 'a non-holder cannot release');
  assert.equal(release(p, 'tab-a').released, true);
  assert.ok(!existsSync(p));
  assert.equal(release(p, 'tab-a').released, false, 'releasing nothing is not an error');
});

test('a lock older than 9 hours is taken over; 8 hours is not', () => {
  const p = lockPath();
  const old = { ns: 'dead-session', pid: 9, started: '2026-10-08T00:00:00.000Z' };
  acquire(p, old);
  const eight = acquire(p, { ns: 'tab-b', pid: 2, started: 'x' }, { now: at('2026-10-08T08:00:00.000Z') });
  assert.equal(eight.ok, false);
  const ten = { ns: 'tab-b', pid: 2, started: '2026-10-08T10:00:00.000Z' };
  assert.deepEqual(acquire(p, ten, { now: at('2026-10-08T10:00:00.000Z') }), { ok: true });
  assert.equal(readLock(p).ns, 'tab-b');
});

test('an unreadable lock, such as the tabs\' old plain-text one, is taken over', () => {
  const p = lockPath();
  acquire(p, { ns: 'tab-a', pid: 1, started: '2026-10-08T01:00:00.000Z' });
  writeFileSync(p, 'tab-3 running playwright since 01:00');
  assert.equal(readLock(p), null);
  const got = acquire(p, { ns: 'tab-b', pid: 2, started: '2026-10-08T01:05:00.000Z' }, { now: at('2026-10-08T01:06:00.000Z') });
  assert.deepEqual(got, { ok: true });
  assert.equal(readLock(p).ns, 'tab-b');
});

test('wait polls until the holder releases', async () => {
  const p = lockPath();
  acquire(p, { ns: 'tab-a', pid: 1, started: '2026-10-08T01:00:00.000Z' });
  let polls = 0;
  const sleep = async () => {
    polls += 1;
    if (polls === 3) release(p, 'tab-a');
  };
  const got = await wait(p, { ns: 'tab-b', pid: 2, started: '2026-10-08T01:01:00.000Z' }, 60_000, { sleep, pollMs: 1, now: at('2026-10-08T01:01:00.000Z') });
  assert.deepEqual(got, { ok: true });
  assert.equal(polls, 3);
});

test('wait gives up at its deadline and reports the holder', async () => {
  const p = lockPath();
  const holder = { ns: 'tab-a', pid: 1, started: '2026-10-08T01:00:00.000Z' };
  acquire(p, holder);
  let t = Date.parse('2026-10-08T01:01:00.000Z');
  const got = await wait(p, { ns: 'tab-b', pid: 2, started: 'x' }, 10_000, {
    pollMs: 1,
    now: () => t,
    sleep: async () => {
      t += 5_000;
    },
  });
  assert.deepEqual(got, { ok: false, holder });
});

test('the command line works end to end', () => {
  const p = lockPath();
  const run = (...args) => JSON.parse(execFileSync(process.execPath, [LOCK_SCRIPT, ...args], { encoding: 'utf8' }).trim());
  assert.deepEqual(run('acquire', 'tab-a', p), { ok: true });
  const refused = run('acquire', 'tab-b', p);
  assert.equal(refused.ok, false);
  assert.equal(refused.holder.ns, 'tab-a');
  assert.deepEqual(run('wait', 'tab-b', '0', p).ok, false);
  assert.deepEqual(run('release', 'tab-b', p), { released: false, holder: refused.holder });
  assert.deepEqual(run('release', 'tab-a', p), { released: true });
  assert.deepEqual(run('acquire', 'tab-b', p), { ok: true });
});

test('a usage error exits 2 and prints no JSON', () => {
  let code = 0;
  try {
    execFileSync(process.execPath, [LOCK_SCRIPT, 'wait', 'tab-a', 'soon'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    code = e.status;
  }
  assert.equal(code, 2);
});
