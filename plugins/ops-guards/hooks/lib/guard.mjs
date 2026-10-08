// Destructive-command guard (job_1e4b82452fe0, mod 3).
//
// Pure functions, no imports. The caller (register.js) owns every `$` call: it passes the
// command and the session's cwd in, and runs the junction probe this file asks for.
//
// This reads the TEXT of a command, so it is a reminder with teeth, not a wall: the
// mods docs say the same of their own force-push example. `bash -c "..."` and `cmd /c ...`
// wrappers are unwrapped one level; an alias, a script file or a variable is not seen.

/** Split a command into segments on ; && || | and newlines, outside quotes. */
export function segments(command) {
  const out = [];
  let cur = '';
  let quote = null;
  const flush = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = '';
  };
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === ';' || c === '\n' || c === '\r') {
      flush();
    } else if ((c === '&' || c === '|') && command[i + 1] === c) {
      flush();
      i += 1;
    } else if (c === '|') {
      flush();
    } else {
      cur += c;
    }
  }
  flush();
  return out;
}

/** Split a segment into words, honouring quotes. Backslashes are literal: Windows paths. */
export function words(segment) {
  const out = [];
  let cur = '';
  let quote = null;
  let started = false;
  for (const c of segment) {
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      started = true;
    } else if (/\s/.test(c)) {
      if (started || cur) out.push(cur);
      cur = '';
      started = false;
    } else {
      cur += c;
    }
  }
  if (started || cur) out.push(cur);
  return out;
}

const SHELLS = new Set(['bash', 'sh', 'zsh', 'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe']);

/** Every executable segment as a word list, unwrapping a shell -c string one level. */
export function commandWords(command, depth = 0) {
  const lists = [];
  for (const seg of segments(command)) {
    const w = words(seg);
    if (w.length === 0) continue;
    lists.push(w);
    if (depth < 2 && SHELLS.has(w[0].toLowerCase().replace(/^.*[\\/]/, ''))) {
      // The inner command is the longest word, which a -c / /c / -Command flag introduces.
      const inner = [...w.slice(1)].filter((x) => /\s/.test(x)).sort((a, b) => b.length - a.length)[0];
      if (inner) lists.push(...commandWords(inner, depth + 1));
      else if (w.length > 2 && /^(-c|\/c|-command)$/i.test(w[1])) lists.push(w.slice(2));
    }
  }
  return lists;
}

// ---- force push --------------------------------------------------------------------

export const FORCE_PUSH_DENY =
  'Force pushes are not allowed from a session. Push a new branch name instead (git push -u origin <new-branch>), ' +
  'or have the human run the force push themselves with the ! prefix.';

function gitVerb(w) {
  if (w[0] !== 'git' && !/(^|[\\/])git(\.exe)?$/i.test(w[0])) return null;
  let i = 1;
  while (i < w.length && w[i].startsWith('-')) {
    // Options that take a value before the verb.
    i += /^-(C|c)$/.test(w[i]) || w[i] === '--git-dir' || w[i] === '--work-tree' ? 2 : 1;
  }
  return i < w.length ? { verb: w[i], args: w.slice(i + 1), rest: w.slice(i) } : null;
}

export function isForcePush(w) {
  const g = gitVerb(w);
  if (!g || g.verb !== 'push') return false;
  return g.args.some(
    (a) =>
      a === '--force' ||
      a.startsWith('--force-with-lease') ||
      a === '--force-if-includes' ||
      /^-[A-Za-z]*f[A-Za-z]*$/.test(a) ||
      (a.startsWith('+') && a.length > 1)
  );
}

// ---- git clean -x ------------------------------------------------------------------

export const GIT_CLEAN_X_DENY =
  'git clean -x / -X deletes ignored files, which includes skills/synced and commands/improve.local.json (the machine settings) ' +
  'and every node_modules. Use git clean -n to list what it would remove, and delete named untracked files individually.';

export function isGitCleanIgnored(w) {
  const g = gitVerb(w);
  if (!g || g.verb !== 'clean') return false;
  return g.args.some((a) => /^-[A-Za-z]*[xX][A-Za-z]*$/.test(a));
}

// ---- recursive delete of a tree that may hold a node_modules junction ----------------

export const JUNCTION_DENY = (target, found) =>
  `${target} holds a node_modules junction (${found}). A recursive delete or git worktree remove can follow the link and empty the main clone's node_modules. ` +
  'Remove the link first, which deletes only the link: cmd /c rmdir "<worktree>\\node_modules". Then retry this command.';

const RM_NAMES = new Set(['rm', 'rm.exe']);
const RMDIR_NAMES = new Set(['rmdir', 'rd']);
const PS_REMOVE = new Set(['remove-item', 'ri', 'rm', 'del', 'erase', 'rmdir', 'rd']);

/** Turn a path the command names into an absolute Windows-style path, or null. */
export function absolutePath(p, cwd) {
  if (!p || /^[$%~]/.test(p)) return null;
  let s = p;
  const gb = /^\/([a-zA-Z])(?:\/(.*))?$/.exec(s);
  if (gb) s = `${gb[1].toUpperCase()}:\\${gb[2] ?? ''}`;
  s = s.replace(/\//g, '\\');
  if (s.startsWith('\\\\')) return null;
  if (!/^[A-Za-z]:\\/.test(s)) {
    if (!cwd) return null;
    s = `${cwd.replace(/[\\/]+$/, '').replace(/\//g, '\\')}\\${s}`;
  }
  const parts = [];
  for (const part of s.split('\\')) {
    if (part === '..') parts.pop();
    else if (part !== '.' && part !== '') parts.push(part);
  }
  // parts[0] is the drive. A wildcard segment ends the path we can inspect.
  const cut = parts.findIndex((x, i) => i > 0 && /[*?]/.test(x));
  const kept = cut === -1 ? parts : parts.slice(0, cut);
  if (kept.length === 0 || !/^[A-Za-z]:$/.test(kept[0])) return null;
  return kept.length === 1 ? `${kept[0]}\\` : kept.join('\\');
}

/** The folders a recursive-delete segment would remove, as absolute paths. */
export function deleteTargets(w, cwd) {
  const name = w[0].toLowerCase().replace(/^.*[\\/]/, '');
  let raw = [];
  const operands = () => w.slice(1).filter((a) => !a.startsWith('-'));
  // POSIX rm: a short cluster of at most four letters holding r or R, or --recursive.
  const posixRecursive = w.slice(1).some((a) => a === '--recursive' || /^-[A-Za-z]{1,4}$/.test(a) && /[rR]/.test(a));
  // PowerShell Remove-Item: -Recurse, or any prefix of it of two letters or more.
  const psRecursive = w.slice(1).some((a) => /^-re(c(u(r(se?)?)?)?)?$/i.test(a));
  if (RM_NAMES.has(name) && posixRecursive) {
    raw = operands();
  } else if (PS_REMOVE.has(name) && psRecursive) {
    raw = operands();
  } else if (RMDIR_NAMES.has(name) && w.some((a) => /^\/s$/i.test(a))) {
    raw = w.slice(1).filter((a) => !/^\/[A-Za-z]$/.test(a));
  } else {
    const g = gitVerb(w);
    if (g && g.verb === 'worktree' && g.rest[1] === 'remove') {
      const operands = g.rest.slice(2).filter((a) => !a.startsWith('-'));
      if (operands.length) raw = [operands[operands.length - 1]];
    }
  }
  return raw.map((p) => absolutePath(p, cwd)).filter(Boolean);
}

/**
 * Probe output of `cmd /c dir /AL /S /B <target>` (every reparse point under the target):
 * returns the first line that is a node_modules link, or null.
 */
export function junctionIn(output) {
  for (const line of String(output ?? '').split(/\r?\n/)) {
    const l = line.trim();
    if (/[\\/]node_modules$/i.test(l)) return l;
  }
  return null;
}

/** Is the target itself a node_modules link? `dir /AL /B <parent>` lists it by name. */
export function selfIsNodeModules(target) {
  return /[\\/]node_modules$/i.test(target);
}

/**
 * Judge a command. Returns { deny } for the outright refusals, and { probe: [paths] } for
 * the recursive deletes whose targets the caller must check for a junction.
 */
export function analyzeCommand(command, cwd) {
  const probe = [];
  for (const w of commandWords(String(command ?? ''))) {
    if (isForcePush(w)) return { deny: FORCE_PUSH_DENY };
    if (isGitCleanIgnored(w)) return { deny: GIT_CLEAN_X_DENY };
    for (const t of deleteTargets(w, cwd)) if (!probe.includes(t)) probe.push(t);
  }
  return probe.length ? { probe } : {};
}
