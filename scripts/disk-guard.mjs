// Disk hygiene for /improve drivers, as code (job_fc71e9b0d728).
//
// Every job gets a worktree with its own node_modules, and until now nothing
// removed either. This file holds the two decisions that stop that:
//   preflight: is there enough free disk to claim a job or run an install?
//   cleanup:   which worktrees may lose node_modules, which may be removed.
//
// FAIL CLOSED. A worktree whose state cannot be read is kept and listed, never
// removed. A free-space reading that cannot be taken stops the claim.
//
// CLI:
//   node scripts/disk-guard.mjs preflight <worktrees_root> [minFreeGb]
//   node scripts/disk-guard.mjs cleanup <worktrees_root> [--apply]

import { statfsSync, readdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MIN_FREE_GB = 20;
const GB = 1024 ** 3;

export function freeGb(path, statfs = statfsSync) {
  const s = statfs(path);
  return (Number(s.bavail) * Number(s.bsize)) / GB;
}

// `minFreeGb` is improve.local.json's `min_free_gb`; unset means the default.
export function preflight(path, minFreeGb = DEFAULT_MIN_FREE_GB, statfs = statfsSync) {
  let free;
  try {
    free = freeGb(path, statfs);
  } catch (e) {
    return { ok: false, reason: `could not read free space on ${path}: ${e.message}` };
  }
  if (!Number.isFinite(free)) return { ok: false, reason: `free space on ${path} is not a number` };
  const rounded = Math.round(free * 10) / 10;
  if (free < minFreeGb) {
    return { ok: false, freeGb: rounded, reason: `${rounded} GB free on ${path}, below the ${minFreeGb} GB minimum` };
  }
  return { ok: true, freeGb: rounded };
}

// What to do with one worktree. `prState` is the state of the newest pull
// request from its branch: OPEN, MERGED, CLOSED, NONE, or UNKNOWN when it could
// not be read.
//   remove        : PR merged or closed, tree clean, nothing unpushed.
//   strip         : PR open, so the work is parked; node_modules can go.
//   keep-listed   : uncommitted or unpushed work, or a state that cannot be
//                   read. Never touched, and named to the human.
//   keep          : no PR yet, so the job is still running.
export function classifyWorktree({ dirty, unpushed, prState }) {
  if (dirty === undefined || unpushed === undefined || prState === 'UNKNOWN') {
    return { action: 'keep-listed', reason: 'state could not be read' };
  }
  if (dirty) return { action: 'keep-listed', reason: 'uncommitted changes' };
  if (unpushed > 0) return { action: 'keep-listed', reason: `${unpushed} unpushed commit(s)` };
  if (prState === 'MERGED' || prState === 'CLOSED') return { action: 'remove', reason: `pull request ${prState.toLowerCase()}` };
  if (prState === 'OPEN') return { action: 'strip', reason: 'pull request open' };
  return { action: 'keep', reason: 'no pull request yet' };
}

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// Reads the state classifyWorktree needs. Any failure leaves the field
// undefined or UNKNOWN, which classifies as keep-listed.
export function inspectWorktree(dir, exec = run) {
  const out = { dir };
  try {
    out.branch = exec('git', ['-C', dir, 'branch', '--show-current']);
    out.dirty = exec('git', ['-C', dir, 'status', '--porcelain']) !== '';
    // Commits on HEAD that no remote-tracking ref has.
    out.unpushed = Number(exec('git', ['-C', dir, 'rev-list', '--count', 'HEAD', '--not', '--remotes']));
  } catch {
    return out;
  }
  if (!out.branch) return { ...out, prState: 'UNKNOWN' };
  try {
    const repo = exec('git', ['-C', dir, 'remote', 'get-url', 'origin']).replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '');
    const prs = JSON.parse(exec('gh', ['pr', 'list', '--repo', repo, '--head', out.branch, '--state', 'all', '--json', 'state,number', '--limit', '5']));
    if (prs.length === 0) out.prState = 'NONE';
    else out.prState = [...prs].sort((a, b) => b.number - a.number)[0].state;
  } catch {
    out.prState = 'UNKNOWN';
  }
  return out;
}

// Only directories that are linked worktrees (a `.git` file, not a folder) are
// considered, so loose files and unrelated folders under the root are ignored.
export function listWorktreeDirs(root) {
  const dirs = [];
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    try {
      if (statSync(dir).isDirectory() && statSync(join(dir, '.git')).isFile()) dirs.push(dir);
    } catch {
      // not a worktree
    }
  }
  return dirs;
}

export function planCleanup(root, inspect = inspectWorktree, list = listWorktreeDirs) {
  return list(root).map((dir) => {
    const info = inspect(dir);
    return { ...info, ...classifyWorktree(info) };
  });
}

// Applies a plan. Removal uses plain `git worktree remove` (no --force), which
// git itself refuses on a dirty tree, as a second guard behind classifyWorktree.
export function applyPlan(plan, exec = run, rm = rmSync, exists = existsSync) {
  const results = [];
  for (const w of plan) {
    try {
      if (w.action === 'strip' || w.action === 'remove') {
        const nm = join(w.dir, 'node_modules');
        if (exists(nm)) rm(nm, { recursive: true, force: true });
      }
      if (w.action === 'remove') {
        const common = exec('git', ['-C', w.dir, 'rev-parse', '--git-common-dir']);
        // Not `-C <dir>`: git would then hold the folder as its cwd and Windows
        // refuses to delete it.
        const gitDir = resolve(w.dir, common);
        exec('git', ['--git-dir', gitDir, 'worktree', 'remove', w.dir]);
        exec('git', ['--git-dir', gitDir, 'worktree', 'prune']);
      }
      results.push({ dir: w.dir, action: w.action, done: true });
    } catch (e) {
      results.push({ dir: w.dir, action: w.action, done: false, error: e.message });
    }
  }
  return results;
}

// The 10 biggest folders directly under the user's home, for the stop message.
export function biggestHomeFolders(home = homedir(), size = dirSize, n = 10) {
  return readdirSync(home, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name, gb: size(join(home, d.name)) / GB }))
    .sort((a, b) => b.gb - a.gb)
    .slice(0, n);
}

function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) stack.push(p);
      else {
        try {
          total += statSync(p).size;
        } catch {
          // vanished mid-walk
        }
      }
    }
  }
  return total;
}

function main(argv) {
  const [cmd, root, ...rest] = argv;
  if (!root) {
    console.error('usage: disk-guard.mjs preflight <worktrees_root> [minFreeGb] | cleanup <worktrees_root> [--apply]');
    return 2;
  }
  if (cmd === 'cleanup') {
    const plan = planCleanup(root);
    const results = rest.includes('--apply') ? applyPlan(plan) : [];
    for (const w of plan) console.log(`${w.action.padEnd(11)} ${w.dir}  (${w.reason})`);
    for (const r of results.filter((x) => !x.done)) console.log(`FAILED ${r.dir}: ${r.error}`);
    console.log(`${plan.length} worktrees read`);
    return 0;
  }
  if (cmd === 'preflight') {
    const min = rest[0] === undefined ? DEFAULT_MIN_FREE_GB : Number(rest[0]);
    if (!Number.isFinite(min)) {
      console.error(`minFreeGb "${rest[0]}" is not a number`);
      return 2;
    }
    const v = preflight(root, min);
    console.log(v.ok ? `ok: ${v.freeGb} GB free` : `STOP: ${v.reason}`);
    return v.ok ? 0 : 1;
  }
  console.error(`unknown command "${cmd}"`);
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
