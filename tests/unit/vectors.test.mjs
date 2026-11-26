import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildVectors, serialize, VECTORS_PATH } from '../../scripts/vectors.mjs';

// The mobile apps test against tests/vectors/core.json. If the extension core changes what it produces, the file must be
// regenerated in the same change (`npm run vectors`), so the mobile apps are checked against the new behavior.
test('conformance vectors match the extension core', async () => {
  assert.equal(readFileSync(VECTORS_PATH, 'utf8'), serialize(await buildVectors()), 'tests/vectors/core.json is out of date: run `npm run vectors`');
});
