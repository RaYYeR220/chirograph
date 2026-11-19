import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { OpenInSwap, OpenOutSwap, QuoteRequest, SwapRecord } from '@chirograph/sdk';
import type { Engine } from './engine.js';
import { UserError, publicMessage } from './errors.js';

export async function buildServer(engine: Engine) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 64 * 1024 });
  await app.register(cors, { origin: true });

  // Uniform error shape; never leak stack traces.
  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
    if (err instanceof UserError || err.validation) {
      return reply.status(400).send({ error: publicMessage(err) });
    }
    req.log.error({ err }, 'request failed');
    return reply.status(502).send({ error: 'The solver could not complete this request. Nothing was sent; please retry.' });
  });

  app.get('/health', async () => ({ ok: true }));
  app.get('/v1/info', async () => engine.info());
  app.get('/v1/solver', async () => engine.addresses());

  app.post<{ Body: QuoteRequest }>('/v1/quote', async (req) => engine.quote(req.body));
  app.post<{ Body: OpenInSwap }>('/v1/swaps/in', async (req) => engine.openIn(req.body));
  app.post<{ Body: OpenOutSwap }>('/v1/swaps/out', async (req) => engine.openOut(req.body));
  app.post<{ Params: { id: string }; Body: { secret: string } }>('/v1/swaps/:id/reveal', async (req) =>
    engine.reveal(req.params.id, req.body.secret));
  app.post<{ Params: { id: string }; Body: { txid: string } }>('/v1/swaps/:id/claimed', async (req) =>
    engine.claimed(req.params.id, req.body.txid));

  app.get<{ Querystring: { limit?: string } }>('/v1/swaps', async (req) =>
    engine.list(Number(req.query.limit ?? 50)).map(publicView));

  app.get<{ Params: { id: string } }>('/v1/swaps/:id', async (req, reply) => {
    const swap = engine.get(req.params.id);
    if (!swap) return reply.status(404).send({ error: 'unknown swap' });
    return publicView(swap);
  });

  // Server-sent events: one stream per swap, or '*' for the live explorer feed.
  app.get<{ Params: { id: string } }>('/v1/swaps/:id/events', (req, reply) => {
    const id = req.params.id === 'all' ? '*' : req.params.id.replace(/^0x/, '').toLowerCase();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    const send = (s: SwapRecord) => reply.raw.write(`data: ${JSON.stringify(publicView(s))}\n\n`);
    if (id !== '*') {
      const current = engine.get(id);
      if (current) send(current);
    }
    engine.events.on(id, send);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 20_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      engine.events.off(id, send);
    });
  });

  return app;
}

/**
 * What the public sees. The secret is only shown once it is already public on a chain, which
 * is exactly when a swap reaches `secret_revealed` or later.
 */
function publicView(s: SwapRecord): SwapRecord {
  const revealed = s.status === 'secret_revealed' || s.status === 'completed';
  return revealed ? s : { ...s, secret: undefined };
}
