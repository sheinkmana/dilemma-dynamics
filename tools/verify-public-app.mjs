// Verify the compiled public transport cannot reach localhost API routes or SSE.
// Study data and module-preload fetches remain valid static asset requests.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = 'dist/web/assets';
if (!readFileSync('dist/web/FINAL_EVALUATION.md').equals(readFileSync('FINAL_EVALUATION.md'))) {
  throw new Error('Public evaluation download differs from the maintained guide.');
}
const scripts = readdirSync(directory).filter((name) => name.endsWith('.js'));
if (!scripts.length) throw new Error('Build the public app before verifying it.');
for (const name of scripts) {
  const source = readFileSync(join(directory, name), 'utf8');
  if (/\bEventSource\b|\/api(?:\/|["'`])|api\.tokenfactory\.nebius\.com/.test(source)) {
    throw new Error(`Public app contains a server or inference transport: ${name}`);
  }
}
console.log(
  `Public app transport verified: ${scripts.length} scripts, no API, inference endpoint or server event stream.`,
);
