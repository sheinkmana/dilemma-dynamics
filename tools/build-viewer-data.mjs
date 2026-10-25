// Build the app's deliberately small, typed scientific projection. Never import
// the full scientific export into a browser bundle: it also retains operational
// and accounting provenance needed by repository verification.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (name) => JSON.parse(readFileSync(resolve(root, 'public/research', name), 'utf8'));

function pick(value, fields, optional = []) {
  const result = {};
  for (const key of fields) {
    if (!(key in value)) throw new Error(`Missing viewer-data field: ${key}`);
    result[key] = value[key];
  }
  for (const key of optional) if (key in value) result[key] = value[key];
  return result;
}
const rows = (values, fields, optional) => values.map((value) => pick(value, fields, optional));
const intervalFields = ['estimate', 'interval', 'coverage', 'blocksPerStratum', 'interpretation'];
const effectFields = [
  'temperature',
  'episodesPerArm',
  'nano-direct',
  'nano-draft',
  'super-direct',
  'super-draft',
  'nanoEffect',
  'superEffect',
];

export function projectViewerData(summary, diagnostics, provenance) {
  const result = {
    schemaVersion: 1,
    summary: {
      ...pick(summary, [
        'selectedBlocksPerTemperature',
        'scheduled',
        'completed',
        'complete',
        'requestCount',
      ]),
      arms: rows(summary.arms, [
        'temperature',
        'arm',
        'benchmarkCompleted',
        'meanOracleLoss',
        'zeroLossEpisodes',
        'benchmarkDecisions',
        'zeroGapDecisions',
        'requests',
        'promptTokens',
        'completionTokens',
        'drafts',
        'cappedDrafts',
        'requestMedianSeconds',
        'requestP95Seconds',
      ]),
      contrasts: rows(
        summary.contrasts,
        ['family', 'contrast', ...intervalFields],
        ['model', 'temperature', 'direction', 'arm'],
      ),
      scheduledOutcomeBounds: rows(summary.scheduledOutcomeBounds, [
        'temperature',
        'model',
        'lower',
        'upper',
        'interpretation',
      ]),
      cooperation: rows(summary.cooperation, [
        'temperature',
        'cell',
        'completed',
        'rounds',
        'CC',
        'CD',
        'DC',
        'DD',
        'roundWeightedCC',
        'episodeWeightedCC',
        'firstCC',
        'meanNormalisedJointReturn',
        'breakdownCount',
        'recoveryCount',
        'breakdownOpportunities',
        'recoveryOpportunities',
      ]),
    },
    diagnostics: {
      scope:
        'Exploratory analyses of the completed evaluation; nominal intervals, no multiplicity control.',
      policyEffects: rows(diagnostics.policyEffects, ['policy', ...effectFields]),
      conditions: rows(diagnostics.conditions, ['condition', ...effectFields]),
      strata: rows(diagnostics.strata, [
        'temperature',
        'stratum',
        'model',
        'direct',
        'draft',
        'effect',
      ]),
      firstActions: rows(diagnostics.firstActions, [
        'temperature',
        'condition',
        'arm',
        'cooperate',
        'episodes',
        'optimalFirstActions',
      ]),
      finiteHorizon: rows(diagnostics.finiteHorizon, [
        'temperature',
        'arm',
        'policy',
        'episodes',
        'optimalPaths',
        'roundCooperations',
        'meanOwnPayoff',
      ]),
      autonomousContrasts: rows(diagnostics.autonomousContrasts, [
        'temperature',
        'model',
        'metric',
        'contrast',
        ...intervalFields,
      ]),
      temperatureHistoryChanges: rows(diagnostics.temperatureHistoryChanges, [
        'arm',
        'episodes',
        'differentHistories',
      ]),
      metadataSelectedExamples: rows(diagnostics.metadataSelectedExamples, [
        'temperature',
        'id',
        'cell',
        'block',
        'loss',
        'subjectPath',
      ]),
      requestDiagnostics: diagnostics.requestDiagnostics.map((row) => ({
        ...pick(row, [
          'temperature',
          'arm',
          'transmitted',
          'successful',
          'successfulDrafts',
          'cappedDrafts',
        ]),
        reportedModels: Object.fromEntries(
          Object.entries(row.reportedModels).map(([model, count]) => [model, Number(count)]),
        ),
        systemFingerprints: Object.fromEntries(
          Object.entries(row.systemFingerprints).map(([fingerprint, count]) => [
            fingerprint,
            Number(count),
          ]),
        ),
      })),
      autonomousPooled: rows(diagnostics.autonomousPooled, [
        'temperature',
        'episodes',
        'rounds',
        'CC',
        'episodeWeightedCC',
      ]),
      transportSegments: diagnostics.transportSegments.map((row) => ({
        ...pick(row, ['temperature', 'arm']),
        original: pick(row.original, ['episodes', 'meanLoss']),
        recovery: pick(row.recovery, ['episodes', 'meanLoss']),
      })),
    },
    provenance: {
      study: 'Evaluation',
      ...pick(provenance, [
        'finalElapsedHours',
        'nativeScoredEpisodeCoverage',
        'historicalDevelopmentEpisodesPooled',
      ]),
    },
  };
  assertViewerPrivacy(result);
  if (result.summary.completed !== 7104 || !result.summary.complete)
    throw new Error('Incomplete scientific export');
  return result;
}

export function assertViewerPrivacy(value) {
  const reserved =
    /(?:usd|accounting|billing|approval|evidenceHead|sourceSha256|specSha256|amendmentSha256|campaignCap|budget)/i;
  const visit = (item) => {
    if (typeof item === 'number' && !Number.isFinite(item))
      throw new Error('Non-finite viewer-data number');
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      if (reserved.test(key)) throw new Error(`Local-only viewer-data field: ${key}`);
      visit(child);
    }
  };
  visit(value);
}

export function buildViewerData() {
  return projectViewerData(read('summary.json'), read('diagnostics.json'), read('provenance.json'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const contents = JSON.stringify(buildViewerData(), null, 2) + '\n';
  const destination = resolve(root, 'src/web/viewer-study.json');
  if (process.argv.includes('--check')) {
    if (readFileSync(destination, 'utf8') !== contents)
      throw new Error('Viewer data is stale; run npm run viewer:data');
    console.log('Viewer scientific projection is current and excludes local-only fields.');
  } else {
    writeFileSync(destination, contents);
    console.log('Generated app scientific projection.');
  }
}
