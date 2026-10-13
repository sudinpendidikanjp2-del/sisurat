import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { env } from './config/env';
import type { Deps } from './lib/deps';
import { AppError } from './lib/errors';
import authPlugin from './plugins/auth';
import authRoutes from './modules/auth/routes';
import userRoutes from './modules/admin/users';
import roleRoutes from './modules/admin/roles';
import letterRoutes from './modules/letters/routes';
import documentRoutes from './modules/documents/routes';
import dispositionRoutes from './modules/dispositions/routes';
import outgoingRoutes from './modules/outgoing/routes';
import systemRoutes from './modules/system/routes';
import reportRoutes from './modules/reports/routes';

export interface BuildOptions {
  logger?: boolean | object;
}

export async function buildApp(deps: Deps, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? {
      level: env.LOG_LEVEL,
      // Never log bodies, cookies or auth headers — they may contain letter content or credentials.
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]'],
    },
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        frameAncestors: ["'self'"],
        objectSrc: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    allowList: env.NODE_ENV === 'test' ? () => true : undefined,
  });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 30 } });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Data tidak valid', details: err.issues } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) {
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Terlalu banyak permintaan. Coba lagi nanti.' } });
    }
    if (status === 413 || (err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Berkas atau data terlalu besar' } });
    }
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: 'BAD_REQUEST', message: 'Permintaan tidak valid' } });
    }
    const e = err as Error;
    req.log.error({ err: { message: e.message, stack: e.stack } }, 'Unhandled error');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Terjadi kesalahan pada server' } });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: `Endpoint ${req.method} ${req.url.split('?')[0]} tidak ditemukan` } }),
  );

  app.get('/api/health', async () => {
    await deps.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  });

  await app.register(authPlugin, deps);
  for (const routes of [authRoutes, userRoutes, roleRoutes, letterRoutes, documentRoutes, dispositionRoutes, outgoingRoutes, systemRoutes, reportRoutes]) {
    await app.register(async (instance) => routes(instance, deps));
  }
  return app;
}
