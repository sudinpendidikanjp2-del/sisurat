import type { FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import { badRequest, unauthorized } from './errors';
import type { ActionContext, AuthUser } from './context';

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest(
      'Data yang dikirim tidak valid',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function ctxOf(req: FastifyRequest): ActionContext {
  return { user: requireUser(req), ip: req.ip, userAgent: req.headers['user-agent'] };
}

export function pageMeta(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
