import test from 'node:test';
import assert from 'node:assert/strict';
import { pageForHash, primaryPage } from '../src/web/navigation.js';

test('new and legacy bookmarks retain access within two primary sections', () => {
  for (const hash of ['', '#play', '#dilemma', '#unknown']) assert.equal(pageForHash(hash), 'play');
  assert.equal(pageForHash('#analysis'), 'analysis');
  assert.equal(primaryPage(pageForHash('#analysis')), 'play');
  assert.equal(pageForHash('#replay'), 'replay');
  assert.equal(primaryPage(pageForHash('#replay')), 'results');
  assert.equal(pageForHash('#results'), 'results');
  assert.equal(pageForHash('#recreational'), 'recreational');
});
