// The heavy-work lock, as a command (job_1e4b82452fe0, mod 1).
//
// This is a port of acquireHeavyLock / releaseHeavyLock / waitForHeavyLock in capsid's
// scripts/overnight-guard.mjs, so a tab and the nightly scheduler share one lock:
//   file     ~/.capsid/overnight-heavy.lock
//   create   openSync(path, "wx"), which fails if the file exists
//   body     JSON { ns, pid, started } with `started` an ISO time
//   stale    older than 9 hours, or unreadable, is removed and taken over
//   release  only when the file's `ns` is ours
// The scheduler reads `ns` and `started` and nothing else, so extra fields would be safe,
// but none are added. test/ops-guards-lock.test.mjs pins this format.
//
// The hooks module cannot make an exclusive create itself ($.fs.write replaces in place),
// and a hooks module may import only its own files, so the mod runs this file with
// $.process.run. Run directly:
//   node lock.mjs acquire <ns> [lockPath]
//   node lock.mjs wait    <ns> <waitMs> [lockPath]
//   node lock.mjs release <ns> [lockPath]
// Output is one line of JSON. Exit 0 for any answer, 2 for a usage or I/O error.
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_LOCK = join(homedir(), '.capsid', 'overnight-heavy.lock');
export const STALE_MS = 9 * 3_600_000;

export function readLock(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed.ns === 'string' && typeof parsed.started === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function acquire(path, info, { now = Date.now, staleMs = STALE_MS } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path, 'wx');
      try {
        writeSync(fd, JSON.stringify(info));
      } finally {
        closeSync(fd);
      }
      return { ok: true };
    } catch (err) {
      if (!(err instanceof Error) || err.code !== 'EEXIST') throw err;
    }
    const holder = readLock(path);
    const age = holder ? now() - Date.parse(holder.started) : Number.POSITIVE_INFINITY;
    // An unreadable lock is as stale as one past its time: nothing can say who holds it.
    if (age <= staleMs) return { ok: false, holder };
    rmSync(path, { force: true });
  }
  return { ok: false, holder: readLock(path) };
}

export function release(path, ns) {
  const holder = readLock(path);
  if (holder && holder.ns === ns) {
    rmSync(path, { force: true });
    return { released: true };
  }
  return { released: false, holder };
}

export async function wait(path, info, waitMs, { pollMs = 5000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, staleMs } = {}) {
  const deadline = now() + waitMs;
  for (;;) {
    const got = acquire(path, info, { now, ...(staleMs === undefined ? {} : { staleMs }) });
    if (got.ok || now() >= deadline) return got;
    await sleep(pollMs);
  }
}

async function main(argv) {
  const [cmd, ns, ...rest] = argv;
  if (!cmd || !ns) {
    console.error('usage: lock.mjs acquire <ns> [path] | wait <ns> <waitMs> [path] | release <ns> [path]');
    return 2;
  }
  const info = { ns, pid: process.ppid, started: new Date().toISOString() };
  if (cmd === 'acquire') {
    console.log(JSON.stringify(acquire(rest[0] ?? DEFAULT_LOCK, info)));
    return 0;
  }
  if (cmd === 'wait') {
    const waitMs = Number(rest[0]);
    if (!Number.isFinite(waitMs) || waitMs < 0) {
      console.error(`waitMs "${rest[0]}" is not a number`);
      return 2;
    }
    console.log(JSON.stringify(await wait(rest[1] ?? DEFAULT_LOCK, info, waitMs)));
    return 0;
  }
  if (cmd === 'release') {
    console.log(JSON.stringify(release(rest[0] ?? DEFAULT_LOCK, ns)));
    return 0;
  }
  console.error(`unknown command "${cmd}"`);
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 2;
    }
  );
}
