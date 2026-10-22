import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { Runner } from './runner.js';
import { Experiments } from './experiments.js';
import { replayHtml } from './export.js';
import { scenarios } from '../games/scenarios.js';
import { evaluate } from '../games/evaluate.js';
import { DilemmaRunner } from './dilemma-runner.js';
import { registerDilemma } from './dilemma-routes.js';
export async function createApp(
  runner: Runner,
  options: { port?: number; webRoot?: string; onShutdown?: () => Promise<void> } = {},
) {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  const token = randomBytes(32).toString('hex'),
    experiments = new Experiments(runner),
    dilemma = new DilemmaRunner(runner),
    port = options.port ?? 4317;
  let shuttingDown = false;
  app.addHook('onRequest', async (req, reply) => {
    const host = req.headers.host;
    const allowed = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!allowed.includes(host ?? ''))
      return reply.code(403).send({ error: 'Only the local app host is allowed.' });
    if (req.headers.origin && !allowed.map((h) => `http://${h}`).includes(req.headers.origin))
      return reply.code(403).send({ error: 'Cross-origin requests are disabled.' });
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers['x-gamefield-token'] !== token
    )
      return reply.code(403).send({ error: 'Missing local session token. Reload the app.' });
    if (shuttingDown && !['GET', 'HEAD'].includes(req.method) && req.url !== '/api/shutdown')
      return reply.code(503).send({ error: 'The server is shutting down.' });
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('Cross-Origin-Resource-Policy', 'same-origin');
  });
  app.setErrorHandler((error, req, reply) => {
    const err = error as Error;
    reply.code(400).send({
      error:
        err instanceof z.ZodError
          ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
          : err.message,
    });
  });
  app.get('/api/health', async () => {
    const l = runner.store.ledger();
    return {
      version: '0.1.0',
      keyConfigured: runner.provider.configured,
      baseUrl: runner.provider.baseUrl,
      sessionCapUsd: l.cap,
      sessionSpentUsd: l.spent,
      reservedUsd: l.reserved,
      token,
    };
  });
  app.get('/api/models', async () => runner.models());
  registerDilemma(app, dilemma);
  app.post('/api/shutdown', async (_req, reply) => {
    if (!shuttingDown) {
      shuttingDown = true;
      // Send the acknowledgement before closing connections, including live event streams.
      reply.raw.once('finish', () => {
        setImmediate(() => {
          void (options.onShutdown ? options.onShutdown() : app.close()).catch((error) => {
            app.log.error(error, 'Server shutdown failed');
          });
        });
      });
    }
    return { status: 'shutting-down' };
  });
  app.post('/api/models/refresh', async () => runner.discover());
  app.post('/api/models/probe', async (req) =>
    runner.probe(z.object({ model: z.string() }).parse(req.body).model),
  );
  app.post('/api/settings', async (req) => {
    const { cap } = z.object({ cap: z.number().positive().max(1000) }).parse(req.body);
    const l = runner.store.ledger();
    if (cap < l.spent + l.reserved)
      throw new Error('Cap cannot be below recorded and reserved spend.');
    runner.store.setSetting('cap', cap);
    return { cap };
  });
  app.get('/api/scenarios', async () => scenarios);
  app.get('/api/matches', async () =>
    runner.store.matches().map(({ moves, initialState, state, ...m }) => ({
      ...m,
      moveCount: moves.length,
      scores: state.scores,
    })),
  );
  app.post('/api/matches', async (req) => runner.create(req.body));
  app.get<{ Params: { id: string } }>('/api/matches/:id', async (req) =>
    runner.store.getMatch(req.params.id),
  );
  app.get<{ Params: { id: string } }>('/api/matches/:id/attempts', async (req) => {
    runner.store.getMatch(req.params.id);
    return runner.store.attempts(req.params.id);
  });
  app.get<{ Params: { id: string }; Querystring: { move?: string } }>(
    '/api/matches/:id/evaluation',
    async (req) => {
      const m = runner.store.getMatch(req.params.id),
        n = Number(req.query.move ?? m.moves.length);
      if (!Number.isInteger(n) || n < 0 || n > m.moves.length)
        throw new Error('Invalid move index.');
      return evaluate(n ? m.moves[n - 1].state : m.initialState);
    },
  );
  app.post<{ Params: { id: string; action: string } }>('/api/matches/:id/:action', async (req) => {
    const { id, action } = req.params;
    const m = runner.store.getMatch(id);
    if (m.experimentId && runner.store.getExperiment(m.experimentId).status === 'running')
      throw new Error('Use the experiment controls while its scheduler is running.');
    if (action === 'start' || action === 'step') {
      void runner.start(id, action === 'step');
    } else if (action === 'pause') runner.pause(id);
    else if (action === 'stop') runner.stop(id);
    else if (action === 'fork') {
      const b = z.object({ move: z.number().int().min(0) }).parse(req.body);
      if (b.move > m.moves.length) throw new Error('Invalid move index.');
      const initial = b.move ? m.moves[b.move - 1].state : m.initialState;
      return runner.create(m.config, { initial, parent: { id, move: b.move } });
    } else throw new Error('Unknown match action.');
    return runner.store.getMatch(id);
  });
  app.get<{ Params: { id: string } }>('/api/matches/:id/events', async (req, reply) => {
    const id = req.params.id;
    const m = runner.store.getMatch(id);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: any) => {
      if (reply.raw.destroyed) return;
      const data = `${event.type === 'snapshot' ? `id: ${event.match.lastEventId}\n` : ''}data: ${JSON.stringify(event)}\n\n`;
      if (reply.raw.writableLength > 2_000_000) {
        reply.raw.end();
        return;
      }
      reply.raw.write(data);
    };
    runner.on(id, send);
    send({ type: 'snapshot', match: m });
    const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 15000);
    reply.raw.on('close', () => {
      clearInterval(heartbeat);
      runner.off(id, send);
    });
  });
  app.get<{ Params: { id: string; format: string } }>(
    '/api/matches/:id/export/:format',
    async (req, reply) => {
      const m = runner.store.getMatch(req.params.id),
        attempts = runner.store.attempts(m.id),
        format = req.params.format;
      reply.header(
        'Content-Disposition',
        `attachment; filename="game-field-${m.id.slice(0, 8)}.${format === 'html' ? 'html' : format === 'jsonl' ? 'jsonl' : 'json'}"`,
      );
      if (format === 'html') return reply.type('text/html; charset=utf-8').send(replayHtml(m));
      if (format === 'jsonl')
        return reply
          .type('application/x-ndjson')
          .send(
            [{ type: 'match', ...m }, ...attempts.map((a) => ({ type: 'attempt', ...a }))]
              .map((x) => JSON.stringify(x))
              .join('\n') + '\n',
          );
      if (format === 'json') return { schemaVersion: 1, match: m, attempts };
      throw new Error('Unsupported export format.');
    },
  );
  app.get('/api/experiments', async () => runner.store.experiments());
  app.post('/api/experiments', async (req) => experiments.create(req.body));
  app.get<{ Params: { id: string } }>('/api/experiments/:id', async (req) =>
    experiments.report(req.params.id),
  );
  app.get<{ Params: { id: string } }>('/api/experiments/:id/export', async (req, reply) => {
    const report = experiments.report(req.params.id);
    reply.header(
      'Content-Disposition',
      `attachment; filename="comparison-${req.params.id.slice(0, 8)}.json"`,
    );
    return {
      schemaVersion: 1,
      ...report,
      attempts: report.matches.flatMap((m) => runner.store.attempts(m.id)),
    };
  });
  app.post<{ Params: { id: string; action: string } }>(
    '/api/experiments/:id/:action',
    async (req) => {
      const { id, action } = req.params;
      if (action === 'start') experiments.start(id);
      else if (action === 'pause') experiments.pause(id);
      else if (action === 'stop') experiments.stop(id);
      else throw new Error('Unknown experiment action.');
      return runner.store.getExperiment(id);
    },
  );
  const webRoot = options.webRoot ?? resolve('dist/web');
  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/')
        ? reply.code(404).send({ error: 'Route not found.' })
        : reply.sendFile('index.html'),
    );
  }
  app.addHook('preClose', async () => {
    for (const s of runner.store.dilemmas()) if (s.status === 'running') dilemma.stop(s.id);
    for (const e of runner.store.experiments()) if (e.status === 'running') experiments.pause(e.id);
    for (const m of runner.store.matches()) if (m.status === 'running') runner.stop(m.id);
    await experiments.idle();
    await runner.idle();
    await dilemma.idle();
    app.server.closeAllConnections();
  });
  return app;
}
