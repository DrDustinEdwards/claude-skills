import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PATTERNS, redactText, redactResult, isSecretPath, readsSecretFile } from '../plugins/ops-guards/hooks/lib/redact.mjs';

// Fakes of the real shapes, built at run time so no real key is ever written down.
// capsid src/improve-run.ts: capsid_ + 64 hex. src/agents-schema.ts: capsid_agent_ + 64 hex.
const HEX64 = 'a1b2c3d4'.repeat(8);
const OPERATOR_KEY = `capsid_${HEX64}`;
const AGENT_KEY = `capsid_agent_${HEX64}`;
const CF_TOKEN = `cfut_${'Zy9_'.repeat(10)}`;
const GH_PAT = `ghp_${'Ab1'.repeat(12)}`;
const GH_FINE = `github_pat_${'Qq7_'.repeat(20)}`;
const ANTHROPIC = `sk-ant-${'xY3-'.repeat(10)}`;
const BEARER = `Bearer ${'tok.en/'.repeat(5)}`;

const planted = {
  'operator key': [OPERATOR_KEY, OPERATOR_KEY],
  'agent key': [AGENT_KEY, AGENT_KEY],
  'cloudflare cfut_ token': [CF_TOKEN, CF_TOKEN],
  'github classic token': [GH_PAT, GH_PAT],
  'github fine-grained token': [GH_FINE, GH_FINE],
  'anthropic key': [ANTHROPIC, ANTHROPIC],
  'bearer header': [`Authorization: ${BEARER}`, BEARER.slice('Bearer '.length)],
  'named cloudflare secret': [`CLOUDFLARE_API_TOKEN=${'k'.repeat(40)}`, 'k'.repeat(40)],
  'named secret with a colon': [`OPERATOR_KEY: "${'m'.repeat(30)}"`, 'm'.repeat(30)],
};

for (const [name, [text, secret]] of Object.entries(planted)) {
  test(`a planted ${name} never survives redaction`, () => {
    const out = redactText(`before ${text} after`);
    assert.ok(!out.includes(secret), `still present: ${out}`);
    assert.match(out, /\[REDACTED:/);
    assert.match(out, /^before .* after$/, 'surrounding text is kept');
  });
}

test('every pattern in the table is exercised by a planted case', () => {
  // A content check paired with a count of what it covered, so "all pass" cannot mean
  // "nothing was tried". The private-key block is tested on its own below.
  const hit = new Set();
  for (const [text] of Object.values(planted)) {
    for (const [kind, re] of PATTERNS) {
      re.lastIndex = 0;
      if (re.test(text)) hit.add(kind);
      re.lastIndex = 0;
    }
  }
  const all = PATTERNS.map(([kind]) => kind).filter((k) => k !== 'private-key');
  assert.deepEqual([...hit].sort(), [...new Set(all)].sort());
});

test('a private key block is redacted whole', () => {
  const block = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\nAAAA\n-----END OPENSSH PRIVATE KEY-----';
  const out = redactText(`x\n${block}\ny`);
  assert.ok(!out.includes('b3BlbnNzaC1rZXk'));
  assert.match(out, /\[REDACTED:private-key\]/);
});

test('redactResult reaches strings at any depth and returns a copy', () => {
  const result = {
    content: [{ type: 'text', text: `file says ${OPERATOR_KEY}` }, { type: 'text', text: 'fine' }],
    meta: { stderr: `${GH_PAT}`, exitCode: 0, ok: true, none: null },
  };
  const before = JSON.stringify(result);
  const out = redactResult(result);
  assert.ok(!JSON.stringify(out).includes(HEX64));
  assert.ok(!JSON.stringify(out).includes(GH_PAT));
  assert.equal(out.content[1].text, 'fine');
  assert.equal(out.meta.exitCode, 0);
  assert.equal(JSON.stringify(result), before, 'the original is untouched');
  assert.equal(redactResult(`plain ${AGENT_KEY}`).includes(HEX64), false, 'a bare string result is redacted');
});

test('redactResult survives a cycle', () => {
  const a = { text: OPERATOR_KEY };
  a.self = a;
  const out = redactResult(a);
  assert.ok(!out.text.includes(HEX64));
});

test('innocent text is left alone', () => {
  for (const s of [
    'The Bearer token is sent in the Authorization header.',
    'Authorization: Bearer $(cat file)',
    'capsid_agent is the prefix of an agent key',
    'capsid_abc123',
    'sha256 deadbeefdeadbeefdeadbeefdeadbeef',
    'ghp_ is a prefix',
    'the key file agent-claude-skills-driver.key exists',
    'CLOUDFLARE_API_TOKEN is read from the environment',
  ]) {
    assert.equal(redactText(s), s, s);
  }
});

test('reads of key files and .mcp.json are recognised, existence checks are not', () => {
  const deny = [
    'cat C:\\Users\\email\\.capsid\\agent-claude-skills-driver.key',
    'cat ~/.capsid/agent-seat.key',
    'Get-Content "$HOME\\.capsid\\agent-claude-skills-driver.key"',
    'claude mcp add -H "Authorization: Bearer $(cat ~/.capsid/agent-x.key)" capsid',
    'type .mcp.json',
    'grep token .mcp.json',
    'head -c 20 C:/Users/e/.capsid/agent-a.key',
    'node -e "x" < C:/Users/e/.capsid/agent-a.key',
  ];
  const allow = [
    'Test-Path "C:\\Users\\email\\.capsid\\agent-claude-skills-driver.key"',
    'ls ~/.capsid/agent-claude-skills-driver.key',
    'test -f ~/.capsid/agent-seat.key && echo present',
    'git check-ignore .mcp.json',
    'cat README.md',
    'Get-Content commands\\improve.local.json',
  ];
  for (const c of deny) assert.equal(readsSecretFile(c), true, `should refuse: ${c}`);
  for (const c of allow) assert.equal(readsSecretFile(c), false, `should allow: ${c}`);
  assert.equal(deny.length + allow.length, 14, 'count of commands judged');
});

test('isSecretPath names the tool-call paths', () => {
  assert.equal(isSecretPath('C:\\Users\\email\\.capsid\\agent-seat.key'), true);
  assert.equal(isSecretPath('/home/u/.capsid/agent-x.key'), true);
  assert.equal(isSecretPath('C:\\dev\\repo\\.mcp.json'), true);
  assert.equal(isSecretPath('C:\\dev\\repo\\mcp.json.example'), false);
  assert.equal(isSecretPath('C:\\Users\\email\\.capsid\\overnight-heavy.lock'), false);
  assert.equal(isSecretPath(undefined), false);
});
