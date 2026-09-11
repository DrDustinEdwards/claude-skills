#!/usr/bin/env node
// Fetches the Anthropic models overview and each model's prompting guide, stores
// them under guides/, and reports which ones changed since the last fetch.
//
// No secrets. Every URL here is public documentation and the script sends no
// credentials, so it runs the same from a laptop, from CI, or from a job.
//
// Fetches the .md variant of each docs page rather than the HTML. Measured
// 2026-09-11: appending .md to a docs path returns text/markdown (the fable 5.1
// guide is 54572 bytes as markdown against 740542 as HTML), and /index.md 404s.
// Markdown is what we want to hash: it is the text without the page chrome that
// changes on every site deploy.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const GUIDES = join(REPO, 'guides');
const STATE = join(GUIDES, '_state.json');

const DOCS = 'https://platform.claude.com/docs/en';
const OVERVIEW = `${DOCS}/about-claude/models/overview.md`;
const GUIDE = (slug) => `${DOCS}/build-with-claude/prompt-engineering/prompting-claude-${slug}.md`;

// A model id looks like claude-fable-5-1 or claude-haiku-4-5-20251001. The guide
// slug is the id minus the claude- prefix and minus any dated suffix, because the
// guides are named for the model line rather than for a snapshot.
const MODEL_ID = /\bclaude-(fable|mythos|opus|sonnet|haiku)-\d[a-z0-9-]*/g;
const DATED_SUFFIX = /-\d{8}$/;

function slugFor(modelId) {
  return modelId.replace(/^claude-/, '').replace(DATED_SUFFIX, '');
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

async function fetchText(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'claude-skills model-guides (+https://github.com/DrDustinEdwards/claude-skills)' },
  });
  if (res.status === 404) return { status: 404, text: null };
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return { status: res.status, text: await res.text() };
}

async function readState() {
  try {
    return JSON.parse(await readFile(STATE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { models: {} };
    throw err;
  }
}

// Pulls the model ids out of the overview. Returns them deduped and sorted so a
// reordering of the page is not mistaken for a change.
export function discoverModels(overviewMarkdown) {
  const ids = new Set();
  for (const match of overviewMarkdown.matchAll(MODEL_ID)) ids.add(match[0]);
  const slugs = new Set([...ids].map(slugFor));
  return [...slugs].sort();
}

// Compares a fresh fetch against stored state. Pure, so the test can drive it
// without a network.
export function classify(slug, fetched, prior) {
  if (fetched.status === 404) {
    if (!prior) return { slug, state: 'none', changed: false };
    if (prior.status === 404) return { slug, state: 'none', changed: false };
    return { slug, state: 'withdrawn', changed: true };
  }
  const hash = sha256(fetched.text);
  if (!prior) return { slug, state: 'new', changed: true, hash };
  if (prior.status === 404) return { slug, state: 'new', changed: true, hash };
  if (prior.sha256 !== hash) return { slug, state: 'changed', changed: true, hash, priorSha256: prior.sha256 };
  return { slug, state: 'unchanged', changed: false, hash };
}

async function main() {
  const json = process.argv.includes('--json');
  const dryRun = process.argv.includes('--dry-run');

  const overview = await fetchText(OVERVIEW);
  if (overview.status === 404 || !overview.text) {
    throw new Error(`models overview not found at ${OVERVIEW}`);
  }

  const slugs = discoverModels(overview.text);
  // Fail closed. Zero models means the overview moved or its shape changed, and
  // reporting "nothing changed" there would quietly stop every future refresh.
  if (slugs.length === 0) {
    throw new Error(`discovered 0 models in ${OVERVIEW}; the page shape changed`);
  }

  const prior = await readState();
  const results = [];
  const now = new Date().toISOString();

  for (const slug of slugs) {
    const fetched = await fetchText(GUIDE(slug));
    const result = classify(slug, fetched, prior.models?.[slug]);
    results.push(result);

    if (dryRun) continue;
    if (fetched.status === 404) continue;
    await mkdir(GUIDES, { recursive: true });
    // The guide file holds the fetched bytes and nothing else, so its hash is the
    // hash of the document. fetched_at lives in _state.json: stamping it into the
    // file would make every fetch look like a change.
    await writeFile(join(GUIDES, `${slug}.md`), fetched.text, 'utf8');
  }

  const state = { fetched_at: now, overview_sha256: sha256(overview.text), models: {} };
  for (const r of results) {
    const p = prior.models?.[r.slug];
    state.models[r.slug] = r.state === 'none' || r.state === 'withdrawn'
      ? { status: 404, url: GUIDE(r.slug), fetched_at: now }
      : {
          status: 200,
          url: GUIDE(r.slug),
          sha256: r.hash,
          fetched_at: r.changed ? now : (p?.fetched_at ?? now),
          changed_at: r.changed ? now : (p?.changed_at ?? now),
        };
  }
  if (!dryRun) await writeFile(STATE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  const changed = results.filter((r) => r.changed);
  if (json) {
    console.log(JSON.stringify({ fetched_at: now, discovered: slugs, changed, results }, null, 2));
  } else {
    console.log(`discovered ${slugs.length} model(s): ${slugs.join(', ')}`);
    for (const r of results) console.log(`  ${r.state.padEnd(10)} ${r.slug}`);
    console.log(changed.length === 0 ? 'no guide changed' : `${changed.length} changed: ${changed.map((r) => r.slug).join(', ')}`);
  }
}

// Only run when invoked directly, so the test can import the pure helpers.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`model-guides failed: ${err.message}`);
    process.exit(1);
  });
}
