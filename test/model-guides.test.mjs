import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { classify, discoverModels } from '../scripts/model-guides.mjs';

const sha256 = (t) => createHash('sha256').update(t, 'utf8').digest('hex');

// Trimmed from the real overview fetched 2026-09-11. Carries the two shapes that
// matter: a bare model line and a dated snapshot id.
const OVERVIEW = `
| Claude Fable 5.1 | \`claude-fable-5-1\` | latest |
| Claude Opus 5 | \`claude-opus-5\` | |
| Claude Sonnet 5 | \`claude-sonnet-5\` | |
| Claude Haiku 4.5 | \`claude-haiku-4-5-20251001\` | snapshot |
`;

test('discovers every model line in the overview', () => {
  const slugs = discoverModels(OVERVIEW);
  assert.deepEqual(slugs, ['fable-5-1', 'haiku-4-5', 'opus-5', 'sonnet-5']);
  // Count check paired with the content check: a matcher that parsed nothing
  // would return [] and satisfy a "no unexpected models" assertion on its own.
  assert.equal(slugs.length, 4, 'parsed zero models means the matcher broke');
});

test('collapses a dated snapshot id onto its model line', () => {
  assert.deepEqual(discoverModels('`claude-haiku-4-5-20251001`'), ['haiku-4-5']);
});

test('an unparseable overview yields no models, which the caller must treat as failure', () => {
  assert.deepEqual(discoverModels('# Models\n\nSee the table.'), []);
});

test('detects a changed hash', () => {
  const prior = { status: 200, sha256: sha256('old guide text') };
  const result = classify('fable-5-1', { status: 200, text: 'new guide text' }, prior);
  assert.equal(result.state, 'changed');
  assert.equal(result.changed, true);
  assert.equal(result.priorSha256, prior.sha256);
  assert.equal(result.hash, sha256('new guide text'));
});

test('identical bytes are unchanged', () => {
  const text = 'guide text that did not move';
  const result = classify('opus-5', { status: 200, text }, { status: 200, sha256: sha256(text) });
  assert.equal(result.state, 'unchanged');
  assert.equal(result.changed, false);
});

test('a whitespace-only edit still counts as a change', () => {
  // The hash is over raw bytes on purpose. A guide that only regains a paragraph
  // break is a guide a human should look at.
  const result = classify('opus-5', { status: 200, text: 'a\nb' }, { status: 200, sha256: sha256('a b') });
  assert.equal(result.changed, true);
});

test('a model with no guide is recorded, not treated as an error', () => {
  const result = classify('haiku-4-5', { status: 404, text: null }, undefined);
  assert.equal(result.state, 'none');
  assert.equal(result.changed, false);
});

test('a guide that appears for the first time is new', () => {
  const result = classify('haiku-4-5', { status: 200, text: 'fresh' }, { status: 404 });
  assert.equal(result.state, 'new');
  assert.equal(result.changed, true);
});

test('a guide that disappears is a change a human should see', () => {
  const result = classify('opus-5', { status: 404, text: null }, { status: 200, sha256: sha256('was here') });
  assert.equal(result.state, 'withdrawn');
  assert.equal(result.changed, true);
});

test('a no-change run reports nothing changed', () => {
  const guides = { 'fable-5-1': 'f', 'opus-5': 'o', 'sonnet-5': 's' };
  const results = Object.entries(guides).map(([slug, text]) =>
    classify(slug, { status: 200, text }, { status: 200, sha256: sha256(text) }));
  assert.equal(results.filter((r) => r.changed).length, 0);
  assert.equal(results.length, 3, 'a run that classified nothing is not a no-change run');
});
