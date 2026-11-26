import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite, LANGS } from '../../scripts/site.mjs';

/** Builds the site into a temp dir and returns { pages: Map<relative path, html>, out }. */
function build(gaId) {
  const out = join(mkdtempSync(join(tmpdir(), 'authbackup-site-')), '_site');
  buildSite({ gaId, out });
  const pages = new Map();
  const walk = (dir, rel = '') => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name), `${rel}${e.name}/`);
      else if (e.name.endsWith('.html')) pages.set(`${rel}${e.name}`, readFileSync(join(dir, e.name), 'utf8'));
    }
  };
  walk(out);
  return { pages, out };
}

const remoteScripts = (html) => [...html.matchAll(/<script\b[^>]*\bsrc="(https?:[^"]+)"/g)].map((m) => m[1]);

test('site without GA_ID: no page loads a script from another host, no ga.js', () => {
  const { pages, out } = build('');
  try {
    assert.equal(pages.size, LANGS.length + 1); // one landing page per language + privacy.html
    for (const [path, html] of pages) {
      assert.deepEqual(remoteScripts(html), [], path);
      assert.ok(!html.includes('{{'), `${path}: unfilled placeholder`);
    }
    assert.ok(!existsSync(join(out, 'ga.js')));
  } finally {
    rmSync(join(out, '..'), { recursive: true, force: true });
  }
});

test('site with GA_ID: every page loads gtag.js for that ID and ga.js configures it', () => {
  const id = 'G-TEST12345';
  const { pages, out } = build(id);
  try {
    for (const [path, html] of pages) {
      assert.deepEqual(remoteScripts(html), [`https://www.googletagmanager.com/gtag/js?id=${id}`], path);
      assert.ok(html.includes('<script src="/ga.js"></script>'), path);
    }
    const ga = readFileSync(join(out, 'ga.js'), 'utf8');
    assert.ok(ga.includes(`gtag('config', "${id}");`));
    assert.ok(!ga.includes('/*GA_ID*/'));
  } finally {
    rmSync(join(out, '..'), { recursive: true, force: true });
  }
});

test('site: GA_ID that is not a GA4 measurement ID is rejected before anything is written', () => {
  for (const bad of ['UA-12345-1', 'G-', 'g-abc12345', 'G-ABC"><script>']) {
    assert.throws(() => buildSite({ gaId: bad, out: join(tmpdir(), 'authbackup-site-never') }), /GA_ID must be/, bad);
  }
});
