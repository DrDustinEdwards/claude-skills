// Which commands count as heavy work (job_1e4b82452fe0, mod 1).
//
// Narrowed on the seat's answer of 2026-10-08: full test suites now run in CI and never on
// this machine (PR #7), so what is left to collide locally is installs and builds. Text
// matching, so a wrapper or alias gets through; it is a reminder to queue, not a wall.
import { commandWords } from './guard.mjs';

const NODE_PMS = new Set(['npm', 'npm.cmd', 'pnpm', 'pnpm.cmd', 'yarn', 'yarn.cmd', 'bun']);

export function isHeavy(command) {
  for (const w of commandWords(String(command ?? ''))) {
    const exe = w[0].toLowerCase().replace(/^.*[\\/]/, '');
    const args = w.slice(1).filter((a) => !a.startsWith('-'));
    if (NODE_PMS.has(exe.replace(/\.cmd$/, '')) || NODE_PMS.has(exe)) {
      const sub = args[0];
      if (['ci', 'install', 'i', 'add', 'rebuild'].includes(sub)) return true;
      if (sub === 'run' && /^build(?::|$)/.test(args[1] ?? '')) return true;
      if (sub === 'build') return true;
    }
    if (exe === 'npx' || exe === 'npx.cmd') {
      if (args[0] === 'playwright' && args[1] === 'install') return true;
      if (args[0] === 'vite' && args[1] === 'build') return true;
    }
  }
  return false;
}

/** The lock name for this tab: short and recognisable in the scheduler's refusal message. */
export function lockNs(sessionId) {
  return `tab-${String(sessionId ?? 'unknown').slice(0, 8)}`;
}

export function waitMessage(holder) {
  if (!holder) return 'heavy-work lock is held by an unknown session';
  return `heavy-work lock is held by ${holder.ns} since ${holder.started}`;
}
