// Step 4b of commands/improve.md, as code.
//
// The skill lets a driver approve its own gate when the blocked command is ONLY
// a branch push and, optionally, a pull request open. The Worker's classifier is
// the authority (capsid src/jobs.ts, classifyCommand); this is the skill's own
// statement of the shape it tells a driver to block with, so the rule that a
// `cd` segment makes a command unapprovable has a test on this side too.
//
// FAIL CLOSED. A segment this cannot place makes the whole command the human's,
// because a self-approved command the Worker would refuse is a stalled job, and
// one it should have refused is a push nobody confirmed.

const DEFAULT_BRANCHES = new Set(['master', 'main']);

// Any of these anywhere in a push is a human gate: a force push, a refspec that
// could land on another branch, or a delete.
const PUSH_NEVER = [/^--force/, /^-f$/, /^\+/, /^--delete$/, /^-d$/, /^--mirror$/, /^--all$/, /:/];

function classifySegment(segment) {
  const words = segment.split(/\s+/).filter(Boolean);
  if (words[0] === 'git') {
    // `git -C <worktree> push ...` is the policy's push form: the tree travels
    // inside the command, so a driver on a worktree never needs the `cd` prefix
    // that makes the whole command the human's.
    let verb = 1;
    if (words[verb] === '-C') {
      if (!words[verb + 1]) return { ok: false, reason: `"${segment}" is git -C with no path` };
      verb += 2;
    }
    if (words[verb] !== 'push') {
      return { ok: false, reason: `"${segment}" matches no class a driver may approve` };
    }
    const args = words.slice(verb + 1);
    if (args.some((a) => PUSH_NEVER.some((p) => p.test(a)))) {
      return { ok: false, reason: `"${segment}" is a force, delete or refspec push` };
    }
    const positional = args.filter((a) => !a.startsWith('-'));
    if (args.filter((a) => a.startsWith('-')).some((a) => a !== '-u' && a !== '--set-upstream')) {
      return { ok: false, reason: `"${segment}" carries a flag other than -u` };
    }
    if (positional.length !== 2 || positional[0] !== 'origin') {
      return { ok: false, reason: `"${segment}" is not git push -u origin <branch>` };
    }
    if (DEFAULT_BRANCHES.has(positional[1])) {
      return { ok: false, reason: `"${segment}" pushes a default branch` };
    }
    return { ok: true, cls: 'push_branch' };
  }
  if (words[0] === 'gh' && words[1] === 'pr' && words[2] === 'create') {
    return { ok: true, cls: 'open_pr' };
  }
  return { ok: false, reason: `"${segment}" matches no class a driver may approve` };
}

// Returns { selfApprovable, classes } or { selfApprovable: false, reason }.
// Quoted text is not parsed, so a separator inside a PR title or body splits
// the command and the result is a refusal; that is the fail-closed direction.
export function classifyBlockCommand(command) {
  const text = String(command).trim();
  if (text === '') return { selfApprovable: false, reason: 'empty command' };
  if (/[`$<>]|\|(?!\|)/.test(text)) {
    return { selfApprovable: false, reason: 'substitution, redirection or a pipe' };
  }
  const segments = text.split(/\s*(?:&&|\|\||;|\r?\n)\s*/).filter(Boolean);
  const classes = [];
  for (const segment of segments) {
    const verdict = classifySegment(segment);
    if (!verdict.ok) return { selfApprovable: false, reason: verdict.reason };
    classes.push(verdict.cls);
  }
  if (classes[0] !== 'push_branch' || classes.filter((c) => c === 'push_branch').length !== 1) {
    return { selfApprovable: false, reason: 'step 4b is one branch push, optionally followed by a pull request' };
  }
  return { selfApprovable: true, classes };
}
