import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROLE_CODES, paginationSchema, userCreateSchema, userUpdateSchema } from '@sisurat/shared';
import type { Deps } from '../../lib/deps';
import { requireAuth, requirePermission } from '../../plugins/auth';
import { ctxOf, pageMeta, parse } from '../../lib/http';
import { hashPassword, randomToken, sha256 } from '../../lib/crypto';
import { audit } from '../../lib/audit';
import { badRequest, conflict, notFound } from '../../lib/errors';
import type { Prisma } from '../../generated/prisma/client';

const userSelect = {
  id: true,
  username: true,
  email: true,
  fullName: true,
  position: true,
  isActive: true,
  mustChangePassword: true,
  lockedUntil: true,
  lastLoginAt: true,
  createdAt: true,
  unit: { select: { id: true, code: true, name: true } },
  roles: { select: { role: { select: { code: true, name: true } } } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;
const present = (u: UserRow) => ({ ...u, roles: u.roles.map((r) => r.role.code) });

const listQuery = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  role: z.enum(ROLE_CODES).optional(),
  active: z.enum(['true', 'false']).optional(),
});

export default async function userRoutes(app: FastifyInstance, deps: Deps) {
  const { prisma } = deps;
  const manage = requirePermission('user.manage');

  async function roleIds(codes: string[]) {
    const roles = await prisma.role.findMany({ where: { code: { in: codes } } });
    if (roles.length !== codes.length) throw badRequest('Peran tidak dikenal');
    return roles.map((r) => r.id);
  }

  app.get('/api/users', { preHandler: manage }, async (req) => {
    const q = parse(listQuery, req.query);
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(q.q && {
        OR: [
          { fullName: { contains: q.q, mode: 'insensitive' } },
          { username: { contains: q.q, mode: 'insensitive' } },
        ],
      }),
      ...(q.role && { roles: { some: { role: { code: q.role } } } }),
      ...(q.active && { isActive: q.active === 'true' }),
    };
    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: userSelect,
        orderBy: { fullName: 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.user.count({ where }),
    ]);
    return { items: items.map(present), meta: pageMeta(q.page, q.pageSize, total) };
  });

  /** Minimal directory for pickers (forward to leader, choose assignees). */
  app.get('/api/users/directory', { preHandler: requireAuth }, async (req) => {
    const q = parse(z.object({ role: z.enum(ROLE_CODES).optional() }), req.query);
    const users = await prisma.user.findMany({
      where: { isActive: true, deletedAt: null, ...(q.role && { roles: { some: { role: { code: q.role } } } }) },
      select: { id: true, fullName: true, position: true, unit: { select: { name: true } } },
      orderBy: { fullName: 'asc' },
      take: 500,
    });
    return { items: users };
  });

  app.post('/api/users', { preHandler: manage }, async (req, reply) => {
    const body = parse(userCreateSchema, req.body);
    const username = body.username.toLowerCase();
    if (await prisma.user.findUnique({ where: { username } })) throw conflict('Nama pengguna sudah dipakai');
    if (body.email && (await prisma.user.findUnique({ where: { email: body.email } })))
      throw conflict('Email sudah dipakai');
    const ids = await roleIds(body.roles);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username,
          email: body.email ?? null,
          fullName: body.fullName,
          position: body.position ?? null,
          unitId: body.unitId ?? null,
          passwordHash: await hashPassword(body.password),
          mustChangePassword: true,
          roles: { create: ids.map((roleId) => ({ roleId })) },
        },
        select: userSelect,
      });
      await audit(tx, ctxOf(req), {
        action: 'user.created',
        entityType: 'User',
        entityId: created.id,
        after: { username, fullName: body.fullName, roles: body.roles },
      });
      return created;
    });
    return reply.code(201).send(present(user));
  });

  app.patch<{ Params: { id: string } }>('/api/users/:id', { preHandler: manage }, async (req) => {
    const body = parse(userUpdateSchema, req.body);
    const existing = await prisma.user.findFirst({ where: { id: req.params.id, deletedAt: null }, select: userSelect });
    if (!existing) throw notFound('Pengguna tidak ditemukan');
    if (req.params.id === req.user!.id && (body.isActive === false || (body.roles && !body.roles.includes('ADMIN')))) {
      throw badRequest('Anda tidak dapat menonaktifkan atau mencabut peran administrator akun sendiri');
    }
    const ids = body.roles ? await roleIds(body.roles) : null;
    const updated = await prisma.$transaction(async (tx) => {
      if (ids) {
        await tx.userRole.deleteMany({ where: { userId: existing.id } });
        await tx.userRole.createMany({ data: ids.map((roleId) => ({ userId: existing.id, roleId })) });
      }
      const u = await tx.user.update({
        where: { id: existing.id },
        data: {
          fullName: body.fullName,
          email: body.email,
          position: body.position,
          unitId: body.unitId,
          isActive: body.isActive,
        },
        select: userSelect,
      });
      if (body.isActive === false) await tx.session.deleteMany({ where: { userId: existing.id } });
      await audit(tx, ctxOf(req), {
        action: body.roles ? 'user.roles_changed' : 'user.updated',
        entityType: 'User',
        entityId: existing.id,
        before: { ...present(existing), unit: existing.unit?.name },
        after: { ...body },
      });
      return u;
    });
    return present(updated);
  });

  /** Issues a one-time password reset token (shown once to the admin, delivered out-of-band). */
  app.post<{ Params: { id: string } }>('/api/users/:id/reset-token', { preHandler: manage }, async (req) => {
    const user = await prisma.user.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!user) throw notFound('Pengguna tidak ditemukan');
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + 24 * 3600_000);
    await prisma.passwordResetToken.create({
      data: { id: sha256(token), userId: user.id, createdById: req.user!.id, expiresAt },
    });
    await audit(prisma, ctxOf(req), { action: 'user.reset_token_issued', entityType: 'User', entityId: user.id });
    return { token, expiresAt, resetPath: `/reset-password?token=${token}` };
  });

  app.post<{ Params: { id: string } }>('/api/users/:id/unlock', { preHandler: manage }, async (req) => {
    await prisma.user.update({ where: { id: req.params.id }, data: { lockedUntil: null, failedLoginCount: 0 } });
    await audit(prisma, ctxOf(req), { action: 'user.unlocked', entityType: 'User', entityId: req.params.id });
    return { ok: true };
  });
}
