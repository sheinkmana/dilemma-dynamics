// Validate the website allowlist, checksums, scientific projection and transport.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assertViewerPrivacy, buildViewerData } from './build-viewer-data.mjs';

const directory = 'dist/web';
const manifest = JSON.parse(readFileSync(join(directory, 'website-manifest.json'), 'utf8'));
const allowed =
  /^(?:index\.html|LICENSE\.txt|assets\/[^/]+\.(?:js|css)|brands\/(?:nebius\.svg|nvidia\.svg|nebius-nvidia-hackathon\.png)|research\/(?:paper\/report\.pdf|figures\/(?:primary-results|condition-effects|autonomous-self-play)\.png|temperature-(?:zero|one)\/episodes\.json|viewer-study\.json))$/;
const actualFiles = [];
function inspect(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) inspect(path);
    else actualFiles.push(relative(directory, path).replaceAll('\\', '/'));
  }
}
inspect(directory);
const expectedFiles = [...Object.keys(manifest.files), 'website-manifest.json'].sort();
if (JSON.stringify(actualFiles.sort()) !== JSON.stringify(expectedFiles))
  throw new Error('Website file set differs from its checksum manifest');
for (const required of [
  'index.html',
  'LICENSE.txt',
  'research/figures/primary-results.png',
  'research/figures/condition-effects.png',
  'research/figures/autonomous-self-play.png',
  'brands/nebius.svg',
  'brands/nvidia.svg',
  'brands/nebius-nvidia-hackathon.png',
  'research/paper/report.pdf',
  'research/viewer-study.json',
  'research/temperature-zero/episodes.json',
  'research/temperature-one/episodes.json',
]) {
  if (!actualFiles.includes(required))
    throw new Error(`Required website asset is missing: ${required}`);
}
for (const [name, expected] of Object.entries(manifest.files)) {
  if (!allowed.test(name))
    throw new Error(`Website asset is outside the explicit allowlist: ${name}`);
  const bytes = readFileSync(join(directory, name));
  if (createHash('sha256').update(bytes).digest('hex') !== expected)
    throw new Error(`Website checksum mismatch: ${name}`);
  if (
    /\.(?:js|json|html)$/.test(name) &&
    /uncertainBillingAttempts|accountingAmendment|publication-review\.json|accounting\.json|AGENTS\.md|campaignCapUsd|additionalBudgetUsd|budgetCeiling|unresolvedMaximumExposure|evidenceHead|specSha256|sourceSha256/.test(
      bytes.toString(),
    )
  ) {
    throw new Error(`Website asset contains a local-only field or record: ${name}`);
  }
}
const viewer = JSON.parse(readFileSync(join(directory, 'research/viewer-study.json'), 'utf8'));
assertViewerPrivacy(viewer);
if (JSON.stringify(viewer) !== JSON.stringify(buildViewerData()))
  throw new Error('Website viewer data differs from the verified scientific projection');
const scripts = actualFiles.filter((name) => /^assets\/.*\.js$/.test(name));
if (!scripts.length) throw new Error('Build the public app before verifying it');
for (const name of scripts) {
  const source = readFileSync(join(directory, name), 'utf8');
  if (/\bEventSource\b|\/api(?:\/|["'`])|api\.tokenfactory\.nebius\.com/.test(source))
    throw new Error(`Public app contains a server or inference transport: ${name}`);
}
console.log(
  `Public website verified: ${actualFiles.length} allowlisted files, scientific data, checksums and no local-only records or inference transport.`,
);
