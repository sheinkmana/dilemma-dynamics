import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sessionAnalysis } from '../dilemma/analysis.js';
import { DilemmaRunner } from './dilemma-runner.js';
import { dilemmaHtml } from './dilemma-export.js';
export function registerDilemma(app: FastifyInstance, runner: DilemmaRunner) {
  app.get('/api/dilemma/sessions', async () => runner.list());
  app.post('/api/dilemma/sessions', async (req) => {
    const body = z
      .object({ config: z.unknown(), creationKey: z.string().uuid() })
      .strict()
      .parse(req.body);
    return runner.create(body.config, body.creationKey);
  });
  app.get<{ Params: { id: string } }>('/api/dilemma/sessions/:id', async (req) =>
    runner.get(req.params.id),
  );
  app.get<{ Params: { id: string } }>('/api/dilemma/sessions/:id/analysis', async (req) =>
    sessionAnalysis(runner.get(req.params.id)),
  );
  app.get<{ Params: { id: string } }>('/api/dilemma/sessions/:id/audit', async (req) => {
    runner.get(req.params.id);
    return runner.audit(req.params.id);
  });
  app.post<{ Params: { id: string; action: string } }>(
    '/api/dilemma/sessions/:id/:action',
    async (req) => {
      const { id, action } = req.params;
      runner.get(id);
      if (action === 'start' || action === 'step') void runner.start(id, action === 'step');
      else if (action === 'pause') runner.pause(id);
      else if (action === 'stop') runner.stop(id);
      else throw new Error('Unknown Dilemma session action.');
      return runner.get(id);
    },
  );
  app.get<{ Params: { id: string } }>('/api/dilemma/sessions/:id/events', async (req, reply) => {
    const { id } = req.params;
    runner.get(id);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (session: ReturnType<DilemmaRunner['get']>) => {
      if (reply.raw.destroyed) return;
      if (reply.raw.writableLength > 2_000_000) {
        reply.raw.end();
        return;
      }
      reply.raw.write(`id: ${session.version}\ndata: ${JSON.stringify(session)}\n\n`);
    };
    runner.on(id, send);
    send(runner.get(id));
    const timer = setInterval(() => {
      if (!reply.raw.destroyed) reply.raw.write(': heartbeat\n\n');
    }, 15000);
    reply.raw.on('close', () => {
      clearInterval(timer);
      runner.off(id, send);
    });
  });
  app.get<{ Params: { id: string; format: string } }>(
    '/api/dilemma/sessions/:id/export/:format',
    async (req, reply) => {
      const { id, format } = req.params,
        session = runner.get(id);
      if (!['html', 'json', 'jsonl'].includes(format))
        throw new Error('Unsupported export format.');
      reply.header('Content-Disposition', `attachment; filename="dilemma-${id}.${format}"`);
      if (format === 'html')
        return reply.type('text/html; charset=utf-8').send(dilemmaHtml(session));
      const data = {
        schema: 'game-field/dilemma/1',
        session,
        analysis: sessionAnalysis(session),
        attempts: runner.audit(id),
        randomness:
          session.status === 'completed'
            ? {
                seed: runner.store.getDilemma(id).environmentSeed,
                method: 'HMAC-SHA256 decimal rejection sampling, stop:<round>:<retry>',
              }
            : null,
      };
      if (format === 'json') return data;
      return reply
        .type('application/x-ndjson')
        .send(
          [
            JSON.stringify({
              type: 'session',
              schema: data.schema,
              session,
              analysis: data.analysis,
              randomness: data.randomness,
            }),
            ...data.attempts.map((attempt) => JSON.stringify({ type: 'attempt', ...attempt })),
          ].join('\n') + '\n',
        );
    },
  );
}
