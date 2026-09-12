// The skill package format, as code.
//
// A skill is loaded and acted on, so the metadata that says what it is has to be
// machine-checkable rather than a convention people remember. This refuses any
// skill missing an L1 field and runs in CI, which is what makes the format a
// format instead of a README section.
//
// FAIL CLOSED, the same way line-scope.mjs does. The frontmatter parser below
// understands exactly the subset the format uses and refuses everything else,
// because a parser that guesses at YAML it does not understand turns a malformed
// header into a passing one.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const STATUSES = ['candidate', 'live', 'retired'];

// name is required on a skill and derived from the filename on a command, so it
// is checked separately rather than listed here.
const REQUIRED = ['description', 'trigger', 'namespaces', 'version', 'status', 'source', 'termination', 'interface'];

const KEY = /^([A-Za-z][A-Za-z0-9_-]*):(?: (.*))?$/;
const NESTED = /^ {2}([A-Za-z][A-Za-z0-9_-]*):(?: (.*))?$/;

// A double-quoted scalar has to close, and \" and \\ are the only escapes.
const QUOTED = /^"((?:[^"\\]|\\.)*)"$/;

function scalar(raw, where) {
  const v = raw.trim();
  if (v === '|' || v === '>' || v.startsWith('|') || v.startsWith('>')) {
    throw new Error(`${where}: block scalars are not part of this format`);
  }
  const q = v.match(QUOTED);
  if (q) return q[1].replace(/\\(["\\])/g, '$1');
  if (v.startsWith('"')) throw new Error(`${where}: unterminated quote`);
  return v;
}

// Splits a flow list on its top-level commas, so a comma inside a quoted item
// does not end the item.
function flowList(raw, where) {
  const inner = raw.trim().slice(1, -1).trim();
  if (inner === '') return [];
  const items = [];
  let buf = '';
  let quoted = false;
  let escaped = false;
  for (const ch of inner) {
    if (escaped) { buf += ch; escaped = false; continue; }
    if (ch === '\\' && quoted) { buf += ch; escaped = true; continue; }
    if (ch === '"') { quoted = !quoted; buf += ch; continue; }
    if (ch === ',' && !quoted) { items.push(buf); buf = ''; continue; }
    buf += ch;
  }
  if (quoted) throw new Error(`${where}: unterminated quote in list`);
  items.push(buf);
  return items.map((i) => scalar(i, where));
}

function value(raw, where) {
  if (raw === undefined || raw.trim() === '') return '';
  if (raw.trim().startsWith('[')) {
    if (!raw.trim().endsWith(']')) throw new Error(`${where}: unterminated list`);
    return flowList(raw, where);
  }
  return scalar(raw, where);
}

export function parseFrontmatter(text) {
  const src = text.replace(/\r\n/g, '\n');
  if (!src.startsWith('---\n')) return { ok: false, error: 'no frontmatter block', fields: {} };
  const end = src.indexOf('\n---', 3);
  if (end === -1) return { ok: false, error: 'frontmatter is never closed', fields: {} };

  const fields = {};
  let lastKey = null;
  let lineNo = 1;
  for (const line of src.slice(4, end).split('\n')) {
    lineNo++;
    if (line.trim() === '' || line.startsWith('#')) continue;
    const where = `line ${lineNo}`;
    try {
      const nested = line.match(NESTED);
      if (nested) {
        // Only a key that declared itself a map may hold nested keys. This is
        // what catches an accidentally indented top-level field.
        if (!lastKey || typeof fields[lastKey] !== 'object' || Array.isArray(fields[lastKey])) {
          return { ok: false, error: `${where}: "${nested[1]}" is indented under a field that is not a map`, fields };
        }
        fields[lastKey][nested[1]] = value(nested[2], where);
        continue;
      }
      const key = line.match(KEY);
      if (!key) return { ok: false, error: `${where}: cannot read "${line}"`, fields };
      const v = value(key[2], where);
      // An empty value opens a nested map; a later nested line fills it in.
      fields[key[1]] = v === '' && key[2] === undefined ? {} : v;
      lastKey = key[1];
    } catch (e) {
      return { ok: false, error: e.message, fields };
    }
  }
  return { ok: true, error: null, fields };
}

const empty = (v) => v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
  || (v && typeof v === 'object' && Object.keys(v).length === 0);

/**
 * @param {{path: string, text: string, kind: 'skill'|'candidate'|'command',
 *          expectedName: string, vendored?: boolean}} entry
 */
export function validateEntry({ path, text, kind, expectedName, vendored = false }) {
  const errors = [];
  const parsed = parseFrontmatter(text);
  if (!parsed.ok) {
    return { path, kind, name: expectedName, vendored, ok: false, errors: [parsed.error], status: null, version: null };
  }
  const f = parsed.fields;

  for (const field of REQUIRED) {
    if (empty(f[field])) errors.push(`missing required field: ${field}`);
  }

  if (kind !== 'command') {
    if (empty(f.name)) errors.push('missing required field: name');
    else if (f.name !== expectedName) {
      errors.push(`name "${f.name}" does not match its directory "${expectedName}"`);
    }
  }

  if (!empty(f.namespaces) && !Array.isArray(f.namespaces)) {
    errors.push('namespaces must be a list, for example ["*"] or ["foxing"]');
  }

  if (!empty(f.interface)) {
    if (typeof f.interface !== 'object' || Array.isArray(f.interface)) {
      errors.push('interface must be a map of inputs and outputs');
    } else {
      if (empty(f.interface.inputs)) errors.push('interface is missing inputs');
      if (empty(f.interface.outputs)) errors.push('interface is missing outputs');
    }
  }

  if (!empty(f.version) && !SEMVER.test(f.version)) {
    errors.push(`version "${f.version}" is not semver`);
  }

  if (!empty(f.status) && !STATUSES.includes(f.status)) {
    errors.push(`status "${f.status}" is not one of ${STATUSES.join(', ')}`);
  }

  // Where a skill sits and what its status says have to agree, or a status is
  // just a word. The promotion PR moves the directory and flips the status in
  // one commit precisely so these two never drift apart.
  if (kind === 'candidate') {
    if (f.status !== 'candidate') {
      errors.push(`status "${f.status}" but the directory is skills/_candidates/: a candidate says status candidate`);
    }
    if (f.source === 'human') {
      errors.push('source human is not available to a candidate: name the attempt or job id that produced it');
    }
  } else if (f.status === 'candidate') {
    errors.push('status candidate outside skills/_candidates/: a candidate the loader can see is not a candidate');
  }

  return { path, kind, name: f.name ?? expectedName, vendored, ok: errors.length === 0, errors, status: f.status ?? null, version: f.version ?? null };
}

const rel = (root, p) => p.slice(root.length + 1).split(sep).join(posix.sep);

function dirsIn(dir) {
  try {
    return readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory());
  } catch {
    return [];
  }
}

export function validateTree(root) {
  let vendored = [];
  try {
    vendored = JSON.parse(readFileSync(join(root, 'MANIFEST.json'), 'utf8')).vendored?.skills ?? [];
  } catch {
    // A missing manifest is not a validation failure; it only means nothing is
    // marked vendored, and the vendored flag is a report rather than a rule.
  }

  const entries = [];
  const read = (p) => readFileSync(p, 'utf8');

  for (const name of dirsIn(join(root, 'skills'))) {
    if (name === '_candidates') continue;
    const p = join(root, 'skills', name, 'SKILL.md');
    try { statSync(p); } catch { continue; }
    entries.push(validateEntry({
      path: rel(root, p), text: read(p), kind: 'skill', expectedName: name, vendored: vendored.includes(name),
    }));
  }

  for (const name of dirsIn(join(root, 'skills', '_candidates'))) {
    const p = join(root, 'skills', '_candidates', name, 'SKILL.md');
    try { statSync(p); } catch { continue; }
    entries.push(validateEntry({
      path: rel(root, p), text: read(p), kind: 'candidate', expectedName: name,
    }));
  }

  for (const file of readdirSync(join(root, 'commands')).filter((n) => n.endsWith('.md'))) {
    const p = join(root, 'commands', file);
    entries.push(validateEntry({
      path: rel(root, p), text: read(p), kind: 'command', expectedName: file.replace(/\.md$/, ''),
    }));
  }

  return { ok: entries.every((e) => e.ok), entries };
}

function main() {
  const report = validateTree(process.cwd());
  const failures = report.entries.filter((e) => !e.ok);
  for (const f of failures) {
    console.error(`FAIL ${f.path}`);
    for (const e of f.errors) console.error(`     ${e}`);
  }
  const counts = {
    skills: report.entries.filter((e) => e.kind === 'skill').length,
    candidates: report.entries.filter((e) => e.kind === 'candidate').length,
    commands: report.entries.filter((e) => e.kind === 'command').length,
    vendored: report.entries.filter((e) => e.vendored).length,
  };
  console.log(
    `${report.entries.length} checked: ${counts.skills} skills (${counts.vendored} vendored), `
    + `${counts.candidates} candidates, ${counts.commands} commands`,
  );
  if (!report.ok) {
    console.error(`\n${failures.length} failed validation`);
    process.exit(1);
  }
  console.log('every entry carries a complete L1 block');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
