import 'dotenv/config';
import { resolve } from 'node:path';
import { Store } from './store.js';
import { Nebius } from './provider.js';
import { Runner } from './runner.js';
import { createApp } from './app.js';
const port = Number(process.env.PORT ?? 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('PORT must be 1024–65535.');
const url = new URL(process.env.NEBIUS_BASE_URL ?? 'https://api.tokenfactory.nebius.com/v1/');
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
  throw new Error(
    'NEBIUS_BASE_URL must be an HTTPS endpoint without credentials or query parameters.',
  );
if (!url.pathname.endsWith('/')) url.pathname += '/';
const cap = Number(process.env.GAMEFIELD_SESSION_CAP_USD ?? 5);
if (!Number.isFinite(cap) || cap <= 0) throw new Error('Invalid session budget.');
const store = new Store(
    resolve(process.env.GAMEFIELD_DATA_DIR ?? 'data', 'game-field.sqlite'),
    cap,
  ),
  provider = new Nebius(url.toString(), process.env.NEBIUS_API_KEY ?? ''),
  runner = new Runner(store, provider);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await app.close();
  store.close();
  process.exit(0);
}
const app = await createApp(runner, { port, onShutdown: shutdown });
await app.listen({ host: '127.0.0.1', port });
console.log(
  `Game Field · http://127.0.0.1:${port} · ${provider.configured ? 'Nebius key configured' : 'local baselines; no Nebius key configured'}`,
);
if (provider.configured)
  void runner
    .discover()
    .catch(() => console.warn('Model discovery failed. Use Refresh models in the app to retry.'));
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    void shutdown().catch((error) => {
      console.error('Server shutdown failed:', error);
      process.exitCode = 1;
    });
  });
