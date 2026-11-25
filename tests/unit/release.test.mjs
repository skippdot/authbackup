import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRelease } from '../../scripts/release-check.mjs';

test('release: en/ru dictionaries match, keys used in code exist, no hooks, network calls or inline styles', () => {
  assert.deepEqual(checkRelease(), []);
});
