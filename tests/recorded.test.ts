import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRecordedEpisodes, recordedScore } from '../src/dilemma/recorded.js';

const data = JSON.parse(
  readFileSync(
    new URL('../public/research/temperature-one/episodes.json', import.meta.url),
    'utf8',
  ),
);
for (const directory of ['temperature-one/', 'temperature-zero/'])
  test(`recorded replay preserves both seats and every final score at ${directory || 'temperature-one'}`, () => {
    const data = JSON.parse(
      readFileSync(
        new URL(`../public/research/${directory}episodes.json`, import.meta.url),
        'utf8',
      ),
    );
    const rows = parseRecordedEpisodes(data);
    assert.equal(rows.length, 3552);
    for (const row of rows) {
      assert.deepEqual(recordedScore(row, 0), [0, 0]);
      assert.deepEqual(recordedScore(row, row.rounds), row.scores);
    }
    const simple = {
      history: [
        ['C', 'D'],
        ['D', 'C'],
        ['C', 'C'],
      ] as ['C' | 'D', 'C' | 'D'][],
    };
    assert.deepEqual(recordedScore(simple, 1), [0, 5]);
    assert.deepEqual(recordedScore(simple, 2), [5, 5]);
    assert.throws(() => recordedScore(simple, 4));
    assert.throws(() => recordedScore(simple, -1));
  });
test('recorded replay fails closed for altered scores, incomplete records and duplicates', () => {
  assert.throws(() => parseRecordedEpisodes([{ ...data[0], scores: [999, 999] }]));
  assert.throws(() => parseRecordedEpisodes([{ ...data[0], status: 'interrupted' }]));
  assert.throws(() => parseRecordedEpisodes([data[0], data[0]]));
});
