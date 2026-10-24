import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// The component imports CSS for Vite, so the publication contract is checked
// through its data here; the rendered browser is verified separately.
const root = new URL('../public/research/', import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, root), 'utf8'));

test('the complete public package matches its checksum manifest', () => {
  const manifest = read('manifest.json');
  for (const [name, digest] of Object.entries(manifest.files)) {
    assert.equal(
      createHash('sha256')
        .update(readFileSync(new URL(name, root)))
        .digest('hex'),
      digest,
    );
  }
});

for (const directory of ['', 'temperature-zero/'])
  test(`the app snapshot matches the complete ${directory || 'temperature-one'} action data`, () => {
    const summary = read(directory + 'summary.json');
    const episodes = read(directory + 'episodes.json');
    assert.equal(summary.completed, 1776);
    assert.equal(summary.completed, episodes.length);
    assert(episodes.every((row: { status: string }) => row.status === 'completed'));
    const crossplay = episodes.filter((row: { track: string }) => row.track === 'B');
    const counts: Record<string, number> = {};
    for (const row of crossplay)
      for (const pair of row.history) {
        const key = pair.join('');
        counts[key] = (counts[key] ?? 0) + 1;
      }
    assert.deepEqual(counts, summary.jointActionCounts);
    assert.equal(crossplay.length, 240);
    for (const contrast of summary.primary) {
      const means: Record<string, number> = {};
      for (const procedure of ['direct', 'draft']) {
        const group = episodes.filter(
          (row: { track: string; cell: string }) =>
            row.track === 'A' && row.cell.endsWith(`/${contrast.model}-${procedure}`),
        );
        assert.equal(group.length, 384);
        means[procedure] =
          group.reduce(
            (sum: number, row: { normalisedOracleLoss: number }) => sum + row.normalisedOracleLoss,
            0,
          ) / group.length;
        assert(Math.abs(means[procedure] - contrast[`${procedure}Mean`]) < 1e-10);
      }
      assert(Math.abs(means.draft - means.direct - contrast.estimate) < 1e-10);
    }
  });

test('matched temperature datasets retain schedule identity without pooling observations', () => {
  const one = read('episodes.json');
  const zero = read('temperature-zero/episodes.json');
  const plans = [read('plan.json'), read('temperature-zero/plan.json')];
  assert.deepEqual(plans[0].episodes, plans[1].episodes);
  assert.equal(plans[0].procedure.temperature, 1);
  assert.equal(plans[1].procedure.temperature, 0);
  assert.equal(new Set([...one, ...zero].map((row) => row.id)).size, 1776);
  const comparison = read('temperature-comparison.json');
  for (const [arm, change] of Object.entries(comparison.temperatureChanges) as [
    string,
    { temperature0Minus1: number },
  ][]) {
    const means = [read('summary.json'), read('temperature-zero/summary.json')].map(
      (s) => s.arms[arm].meanOracleLoss,
    );
    assert(Math.abs(means[1] - means[0] - change.temperature0Minus1) < 1e-10);
  }
});
