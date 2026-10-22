import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// The component imports CSS for Vite, so the publication contract is checked
// through its data here; the rendered browser is verified separately.
const root = new URL('../public/research/', import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, root), 'utf8'));

test('the app snapshot matches the complete public action data and checksum manifest', () => {
  const summary = read('summary.json');
  const episodes = read('episodes.json');
  const manifest = read('manifest.json');
  for (const [name, digest] of Object.entries(manifest.files)) {
    assert.equal(
      createHash('sha256')
        .update(readFileSync(new URL(name, root)))
        .digest('hex'),
      digest,
    );
  }
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
