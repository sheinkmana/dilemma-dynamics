import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from '../server/store.js';
import { Nebius } from '../server/provider.js';
import { Runner } from '../server/runner.js';
import { Experiments } from '../server/experiments.js';
import { replayHtml } from '../server/export.js';
import { defaultConfig } from '../shared/config.js';
const [command, file, output] = process.argv.slice(2);
if (!command || command === 'help') {
  console.log(`Game Field CLI
  npm run cli -- match [config.json]          Play a match; default is free local baselines
  npm run cli -- tournament experiment.json  Run a prepared comparison
  npm run cli -- list                        List saved matches
  npm run cli -- export MATCH_ID replay.html Save a standalone replay

Uses the same SQLite engine and server-side .env key as the web app.
Stop the web server first, or set GAMEFIELD_DATA_DIR to another directory.`);
  process.exit(0);
}
const store = new Store(
  resolve(process.env.GAMEFIELD_DATA_DIR ?? 'data', 'game-field.sqlite'),
  Number(process.env.GAMEFIELD_SESSION_CAP_USD ?? 5),
);
try {
  const url = new URL(process.env.NEBIUS_BASE_URL ?? 'https://api.tokenfactory.nebius.com/v1/');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('Use a credential-free HTTPS API endpoint.');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  const runner = new Runner(store, new Nebius(url.toString(), process.env.NEBIUS_API_KEY ?? ''));
  if (command === 'match') {
    const input = file ? JSON.parse(readFileSync(resolve(file), 'utf8')) : defaultConfig;
    if (input.players.some((p: any) => p.kind === 'nebius')) await runner.discover();
    const m = runner.create(input);
    let last = 0;
    runner.on(m.id, (e) => {
      if (e.type === 'snapshot' && e.match.moves.length > last) {
        const move = e.match.moves.at(-1);
        last = e.match.moves.length;
        console.log(
          `${last}. ${move.player === 0 ? 'A' : 'B'} ${move.action}  ${move.state.scores.join(':')}  ${move.explanation}`,
        );
      }
    });
    process.once('SIGINT', () => runner.stop(m.id));
    await runner.start(m.id);
    const result = store.getMatch(m.id);
    console.log(
      JSON.stringify(
        {
          id: m.id,
          status: result.status,
          score: result.state.scores,
          message: result.message,
          estimatedUsd: result.spentUsd,
        },
        null,
        2,
      ),
    );
    if (!['completed', 'forfeit'].includes(result.status)) process.exitCode = 1;
  } else if (command === 'tournament') {
    if (!file) throw new Error('Supply an experiment JSON file.');
    const input = JSON.parse(readFileSync(resolve(file), 'utf8'));
    if (input.match.players.some((p: any) => p.kind === 'nebius')) await runner.discover();
    const experiments = new Experiments(runner),
      e = experiments.create(input);
    process.once('SIGINT', () => experiments.stop(e.id));
    experiments.start(e.id);
    await experiments.idle();
    const report = experiments.report(e.id);
    console.log(
      JSON.stringify(
        {
          id: e.id,
          status: report.experiment.status,
          pairedMargin: report.pairedMargin,
          pairedInterval: report.pairedInterval,
          rows: report.rows,
        },
        null,
        2,
      ),
    );
    if (report.experiment.status !== 'completed') process.exitCode = 1;
  } else if (command === 'list') {
    console.log(
      JSON.stringify(
        store
          .matches()
          .map((m) => ({
            id: m.id,
            status: m.status,
            players: m.config.players.map((p) => p.name),
            score: m.state.scores,
            estimatedUsd: m.spentUsd,
          })),
        null,
        2,
      ),
    );
  } else if (command === 'export') {
    if (!file || !output) throw new Error('Supply a match ID and output filename.');
    const m = store.getMatch(file);
    writeFileSync(
      resolve(output),
      output.endsWith('.html')
        ? replayHtml(m)
        : JSON.stringify({ schemaVersion: 1, match: m, attempts: store.attempts(m.id) }, null, 2),
      { flag: 'wx' },
    );
    console.log(`Saved ${resolve(output)}`);
  } else throw new Error('Unknown command. Run npm run cli -- help.');
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  store.close();
}
