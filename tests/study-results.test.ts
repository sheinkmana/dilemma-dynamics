import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { relative, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../public/research/', import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
const summary = read('summary.json');
const zero = read('temperature-zero/episodes.json');
const one = read('temperature-one/episodes.json');
const episodes = [...zero, ...one];

test('the sole final public package matches its complete checksum manifest', () => {
  const manifest = read('manifest.json');
  assert.deepEqual(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => relative(fileURLToPath(root), join(e.parentPath, e.name)).split(sep).join('/'))
      .sort(),
    [...Object.keys(manifest.files), 'manifest.json'].sort(),
  );
  for (const [name, digest] of Object.entries(manifest.files))
    assert.equal(
      createHash('sha256')
        .update(readFileSync(new URL(name, root)))
        .digest('hex'),
      digest,
    );
});

for (const [temperature, data] of [
  [0, zero],
  [1, one],
] as const)
  test(`final results and replay agree at temperature ${temperature}`, () => {
    assert.equal(data.length, 3552);
    assert(
      data.every(
        (e: { temperature: number; status: string }) =>
          e.temperature === temperature && e.status === 'completed',
      ),
    );
    assert.equal(new Set(data.map((e: { block: number }) => e.block)).size, 48);
    for (const arm of summary.arms.filter(
      (a: { temperature: number }) => a.temperature === temperature,
    )) {
      const group = data.filter(
        (e: { track: string; cell: string }) => e.track === 'A' && e.cell.endsWith('/' + arm.arm),
      );
      assert.equal(group.length, 768);
      assert(
        Math.abs(
          group.reduce(
            (s: number, e: { normalisedOracleLoss: number }) => s + e.normalisedOracleLoss,
            0,
          ) /
            group.length -
            arm.meanOracleLoss,
        ) < 1e-10,
      );
    }
    for (const c of summary.cooperation.filter(
      (c: { temperature: number }) => c.temperature === temperature,
    )) {
      const group = data.filter((e: { cell: string }) => e.cell === c.cell);
      assert.equal(group.length, 48);
      const counts: Record<string, number> = { CC: 0, CD: 0, DC: 0, DD: 0 };
      for (const e of group) for (const pair of e.history) counts[pair.join('')]++;
      for (const key of Object.keys(counts)) assert.equal(counts[key], c[key]);
    }
  });

test('temperatures retain paired environments and distinct observation identities', () => {
  assert.equal(summary.completed, episodes.length);
  assert.equal(new Set(episodes.map((e) => e.id)).size, 7104);
  const counterpart = new Map(one.map((e: { matchedId: string }) => [e.matchedId, e]));
  for (const e of zero) {
    const other = counterpart.get(e.matchedId) as Record<string, unknown>;
    assert(other);
    for (const key of [
      'block',
      'stratum',
      'mapping',
      'subjectSeat',
      'players',
      'horizon',
      'rounds',
      'environmentSeed',
    ])
      assert.deepEqual(e[key], other[key]);
  }
});

test('public scientific verification retains all primary comparison intervals', () => {
  const primary = summary.contrasts.filter((c: { family: string }) => c.family === 'primary');
  assert.equal(primary.length, 4);
  assert(
    primary.every(
      (c: { coverage: number; blocksPerStratum: number[] }) =>
        c.coverage === 0.9875 && c.blocksPerStratum.every((b) => b === 12),
    ),
  );
});

test('local accounting and approval records are absent from the scientific export', () => {
  assert.equal(existsSync(new URL('accounting.json', root)), false);
  assert.equal(existsSync(new URL('publication-review.json', root)), false);
});

test('the typed viewer projection matches source science and excludes operational fields', () => {
  execFileSync(process.execPath, ['tools/build-viewer-data.mjs', '--check'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
  });
  const viewer = JSON.parse(
    readFileSync(new URL('../src/web/viewer-study.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(Object.keys(viewer).sort(), [
    'diagnostics',
    'provenance',
    'schemaVersion',
    'summary',
  ]);
  assert.equal(viewer.summary.completed, 7104);
  assert.deepEqual(viewer.summary.contrasts, summary.contrasts);
  assert.deepEqual(viewer.summary.cooperation, summary.cooperation);
  assert.deepEqual(
    viewer.summary.arms,
    summary.arms.map((arm: Record<string, unknown>) => {
      const { estimatedUsd: _local, ...scientific } = arm;
      return scientific;
    }),
  );
  const diagnostics = read('diagnostics.json');
  assert.deepEqual(viewer.diagnostics.policyEffects, diagnostics.policyEffects);
  assert.deepEqual(viewer.diagnostics.autonomousContrasts, diagnostics.autonomousContrasts);
  assert.deepEqual(
    viewer.diagnostics.requestDiagnostics,
    diagnostics.requestDiagnostics.map((row: Record<string, unknown>) => {
      const { uncertainBillingAttempts: _local, ...scientific } = row;
      return scientific;
    }),
  );
  assert(
    !/reservedUsd|spentUsd|estimatedUsd|uncertainBillingAttempts|accounting|billing|approval|evidenceHead|specSha256|sourceSha256|campaignCap|budget/i.test(
      JSON.stringify(viewer),
    ),
  );
});
