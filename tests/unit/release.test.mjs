import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkRelease } from '../../scripts/release-check.mjs';
import { changelogSection, releaseNotes } from '../../scripts/release-notes.mjs';

test('release: en/ru dictionaries match, keys used in code exist, no hooks, network calls or inline styles', () => {
  assert.deepEqual(checkRelease(), []);
});

test('release notes: the manifest version has a CHANGELOG section (release.yml needs it for the tag)', () => {
  const { version } = JSON.parse(readFileSync(new URL('../../extension/manifest.json', import.meta.url), 'utf8'));
  const notes = releaseNotes(version);
  assert.match(notes, new RegExp(`gh attestation verify authbackup-${version.replace(/\./g, '\\.')}\\.zip`));
  const log = '# CHANGELOG\n\n## 2026-01-02: 1.2.10 — later\n\n- ten\n\n## 2026-01-01: 1.2.1 — first\n\n- one\n';
  assert.equal(changelogSection('1.2.1', log), '- one');
  assert.equal(changelogSection('1.2.10', log), '- ten');
  assert.throws(() => changelogSection('1.2', log), /no "## <date>: 1\.2/);
});
