// ops-guards: three guards for tabs and drivers on this machine (job_1e4b82452fe0).
//
//   1. heavy lock     one install or build at a time across tabs and the scheduler
//   2. key redaction  secrets never reach the model, and key files are never read
//   3. command guard  no force push, no git clean -x, no recursive delete of a tree
//                     holding a node_modules junction
//
// No model calls. Each guard has a switch in the plugin's options (userConfig), default
// on. Turning one off, or all, is explained in README.md next to this plugin.
//
// A hooks module has to keep every `$` call visible to `claude plugin validate`, so each
// call is written in full and `$` is passed only to functions declared in this file. The
// decisions live in ./lib, which takes plain data and is tested with `node --test`.
import { analyzeCommand, junctionIn, selfIsNodeModules, JUNCTION_DENY } from './lib/guard.mjs'
import { isHeavy, lockNs, waitMessage } from './lib/heavy.mjs'
import { isSecretPath, readsSecretFile, redactResult, SECRET_READ_DENY } from './lib/redact.mjs'

// $.process.run rejects a timeoutMs over 600000 (10 minutes), and time spent inside a mods
// API call does not count against the hook's own 10 second limit, so the wait happens
// inside lock.mjs. A round is 9 minutes so that round plus margin stays under the cap.
const WAIT_PER_ROUND_MS = 9 * 60_000
const WAIT_ROUNDS = 3

// How many heavy commands this session is running under the lock right now.
let held = 0

async function lockCall($, args, timeoutMs) {
  const run = await $.process.run(['node', $.plugin.root + '/hooks/lock.mjs', ...args], { timeoutMs })
  if (run.exitCode !== 0) throw new Error('lock.mjs ' + args[0] + ' failed: ' + (run.stderr || run.stdout))
  return JSON.parse(run.stdout.trim().split(/\r?\n/).pop())
}

// Returns null when the lock is ours, or the message to refuse with.
async function takeLock($, ns) {
  if (held > 0) {
    held += 1
    return null
  }
  let got = await lockCall($, ['acquire', ns], 30_000)
  if (!got.ok) {
    $.ui.log('ops-guards: ' + waitMessage(got.holder) + '. Waiting for it before this install or build.')
    for (let round = 0; round < WAIT_ROUNDS && !got.ok; round += 1) {
      got = await lockCall($, ['wait', ns, String(WAIT_PER_ROUND_MS)], WAIT_PER_ROUND_MS + 30_000)
    }
  }
  if (!got.ok) {
    return (
      'The heavy-work lock is still held after ' + (WAIT_ROUNDS * WAIT_PER_ROUND_MS) / 60_000 + ' minutes (' +
      waitMessage(got.holder) + '). Do other work and retry this command later; do not delete ~/.capsid/overnight-heavy.lock ' +
      'yourself, because a lock older than 9 hours is taken over automatically.'
    )
  }
  held = 1
  return null
}

async function dropLock($, ns) {
  held = Math.max(0, held - 1)
  if (held === 0) await lockCall($, ['release', ns], 30_000)
}

// The first node_modules link under a delete target, or null.
async function findJunction($, target) {
  if (selfIsNodeModules(target)) {
    const parent = target.slice(0, target.lastIndexOf('\\'))
    const listed = await $.process.run(['cmd', '/c', 'dir', '/AL', '/B', parent], { timeoutMs: 60_000 })
    return listed.exitCode === 0 && /^node_modules\s*$/im.test(listed.stdout) ? target : null
  }
  const listed = await $.process.run(['cmd', '/c', 'dir', '/AL', '/S', '/B', target], { timeoutMs: 120_000 })
  return listed.exitCode === 0 ? junctionIn(listed.stdout) : null
}

const SHELL_TOOLS = ['Bash', 'PowerShell']

export function register(on, options) {
  const wants = (name) => !options || options[name] !== false

  on('tool.call', async ($, e, next) => {
    const isShell = SHELL_TOOLS.includes(e.tool)

    // 3. destructive commands
    if (wants('destructiveGuard') && isShell) {
      const cwd = await $.session.cwd()
      const verdict = analyzeCommand(e.command, cwd)
      if (verdict.deny) return { deny: verdict.deny }
      for (const target of verdict.probe ?? []) {
        const found = await findJunction($, target)
        if (found) return { deny: JUNCTION_DENY(target, found) }
      }
    }

    // 2a. key files are never read
    if (wants('redaction')) {
      const touchesKey =
        (isShell && readsSecretFile(e.command)) ||
        (e.tool === 'Read' && isSecretPath(e.file_path)) ||
        ((e.tool === 'Grep' || e.tool === 'Glob') && (isSecretPath(e.path) || isSecretPath(e.pattern)))
      if (touchesKey) return { deny: SECRET_READ_DENY }
    }

    // 1. heavy work waits its turn
    const heavy = wants('heavyLock') && isShell && isHeavy(e.command)
    let result
    if (heavy) {
      const ns = lockNs(await $.session.id())
      const refusal = await takeLock($, ns)
      if (refusal) return { deny: refusal }
      try {
        result = await next(e)
      } finally {
        await dropLock($, ns)
      }
    } else {
      result = await next(e)
    }

    // 2b. nothing secret in what Claude reads
    return wants('redaction') ? redactResult(result) : result
  }).catch(async ($, e, next) => {
    // Fail closed: a guard that broke must not let the call through unchecked.
    return { deny: 'ops-guards could not check this call (' + next.error.kind + '), so it was not run. Retry; if it persists, the human can disable the plugin in /plugin.' }
  })

  on('session.end', async ($, e, next) => {
    // A tab that closes mid-install must not leave the lock for 9 hours.
    if (held > 0) {
      held = 0
      await lockCall($, ['release', lockNs(await $.session.id())], 30_000)
    }
    return next(e)
  })
}
