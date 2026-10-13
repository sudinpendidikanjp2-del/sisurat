import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db';
import { badRequest, conflict } from './errors';
import type { Prisma } from '../generated/prisma/client';

const IN_PROGRESS = 0;

/**
 * Replays the stored response when a client retries a POST with the same Idempotency-Key header.
 * A placeholder row is claimed before the handler runs, so concurrent duplicates cannot both execute.
 * Keys are scoped per user and route.
 */
export async function withIdempotency<T>(
  db: Db,
  req: FastifyRequest,
  reply: FastifyReply,
  route: string,
  handler: () => Promise<{ status: number; body: T }>,
) {
  const header = req.headers['idempotency-key'];
  if (!header) {
    const res = await handler();
    return reply.code(res.status).send(res.body);
  }
  const clientKey = String(header);
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(clientKey)) throw badRequest('Idempotency-Key tidak valid');
  const key = `${req.user?.id ?? 'anon'}:${route}:${clientKey}`;

  try {
    await db.idempotencyRecord.create({ data: { key, responseCode: IN_PROGRESS, responseBody: {} } });
  } catch {
    const existing = await db.idempotencyRecord.findUnique({ where: { key } });
    if (!existing || existing.responseCode === IN_PROGRESS) {
      throw conflict('Permintaan yang sama sedang diproses');
    }
    reply.header('Idempotent-Replayed', 'true');
    return reply.code(existing.responseCode).send(existing.responseBody);
  }

  try {
    const res = await handler();
    await db.idempotencyRecord.update({
      where: { key },
      data: { responseCode: res.status, responseBody: res.body as unknown as Prisma.InputJsonValue },
    });
    return reply.code(res.status).send(res.body);
  } catch (err) {
    // Failed requests may be retried with the same key.
    await db.idempotencyRecord.delete({ where: { key } }).catch(() => undefined);
    throw err;
  }
}
