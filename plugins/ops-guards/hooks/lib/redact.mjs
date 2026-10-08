// Secret redaction for tool output (job_1e4b82452fe0, mod 2).
//
// Pure functions, no imports: a hooks module may import only its own files, and the
// tests run them under plain `node --test`.
//
// Key shapes are read from the code that makes them, not guessed:
//   capsid src/improve-run.ts        operator key  capsid_ + 64 hex  (32 random bytes)
//   capsid src/agents-schema.ts      agent key     capsid_agent_ + 64 hex
// The `ro:` prefix in OPERATOR_KEY_HASH is on the stored hash entry, never on a key.
// Vendor shapes are from their docs (2026-10-08): GitHub token prefixes ghp_, gho_, ghu_,
// ghs_, ghr_ and github_pat_ (about-authentication-to-github); Cloudflare's scannable
// prefix cfut_ (create-token). Neither vendor documents a length or character set, so
// those patterns take a prefix plus a generous run of token characters. A legacy
// Cloudflare token has no prefix, so it is caught only when assigned to a named variable.

const TOKEN_CHARS = '[A-Za-z0-9_\\-]';

/** [kind, regex, replacement]. A function replacement keeps the label in front of a value. */
export const PATTERNS = [
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g],
  ['capsid-key', /capsid_(?:agent_)?[0-9a-f]{32,}/gi],
  ['cloudflare-token', new RegExp(`cfut_${TOKEN_CHARS}{20,}`, 'g')],
  ['github-token', new RegExp(`(?:gh[pousr]_|github_pat_)${TOKEN_CHARS}{20,}`, 'g')],
  ['anthropic-key', new RegExp(`sk-ant-${TOKEN_CHARS}{20,}`, 'g')],
  [
    'named-secret',
    /\b((?:CLOUDFLARE_API_TOKEN|CLOUDFLARE_API_KEY|CF_API_TOKEN|CF_API_KEY|OPERATOR_KEY|CAPSID_OPERATOR_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN|GH_TOKEN)\s*[=:]\s*["']?)[^\s"']{12,}/g,
    (_m, label) => `${label}[REDACTED:named-secret]`,
  ],
  [
    'bearer',
    /\b(Bearer\s+)[A-Za-z0-9._~+/=\-]{20,}/g,
    (_m, label) => `${label}[REDACTED:bearer]`,
  ],
];

/** Replace every secret in a string. */
export function redactText(text) {
  let out = text;
  for (const [kind, re, replace] of PATTERNS) {
    out = out.replace(re, replace ?? `[REDACTED:${kind}]`);
  }
  return out;
}

/**
 * Redact every string inside a tool result of any shape, returning a copy. The shape of a
 * Read or Bash result is not fixed by the docs I could read, so this walks all of it
 * rather than naming fields. Non-strings pass through; cycles are cut.
 */
export function redactResult(value, seen = new WeakSet()) {
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redactResult(v, seen));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = redactResult(v, seen);
  return out;
}

// Files whose contents a session never needs: driver and seat keys, and the project MCP
// config that carries a driver bearer token.
const KEY_PATH = /(?:^|[\\/])\.capsid[\\/][^\s"'\\/]*\.key\b/i;
const MCP_JSON = /(?:^|[\\/\s"'=])\.mcp\.json\b/i;

export function isSecretPath(path) {
  return typeof path === 'string' && (KEY_PATH.test(path) || MCP_JSON.test(path));
}

// A command that only checks a key file exists (Test-Path, ls, stat) is allowed: /improve
// does exactly that before a claim. One that reads the contents is not.
const READ_VERBS =
  /(?:^|[\s;&|(`$])(?:cat|type|more|less|head|tail|sed|awk|grep|egrep|rg|findstr|xxd|od|base64|certutil|cp|copy|mv|move|scp|curl|Get-Content|gc|Select-String|sls|Copy-Item|cpi|Import-Clixml|ConvertFrom-Json|ReadAllText)\b|<\s*\S/i;

export function readsSecretFile(command) {
  if (typeof command !== 'string') return false;
  return command
    .split(/\r?\n|;|&&|\|\|/)
    .some((segment) => isSecretPath(segment) && READ_VERBS.test(segment));
}

export const SECRET_READ_DENY =
  'Key files and .mcp.json are never read into a session. Nothing a driver does needs their contents. ' +
  'To check one exists use Test-Path or ls; to use a key, ask the user to run the command with the ! prefix so the key stays out of the transcript.';
