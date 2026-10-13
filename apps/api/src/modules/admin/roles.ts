import type { FastifyInstance } from 'fastify';
import { PERMISSIONS, rolePermissionsSchema, unitSchema } from '@sisurat/shared';
import type { Deps } from '../../lib/deps';
import { requireAuth, requirePermission } from '../../plugins/auth';
import { ctxOf, parse } from '../../lib/http';
import { audit } from '../../lib/audit';
import { badRequest, conflict, notFound } from '../../lib/errors';

export default async function roleRoutes(app: FastifyInstance, deps: Deps) {
  const { prisma } = deps;

  app.get('/api/roles', { preHandler: requirePermission('role.manage', 'user.manage') }, async () => {
    const roles = await prisma.role.findMany({
      orderBy: { code: 'asc' },
      include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
    });
    return {
      items: roles.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        userCount: r._count.users,
        permissions: r.permissions.map((p) => p.permission.code).sort(),
      })),
      catalog: Object.entries(PERMISSIONS).map(([code, description]) => ({ code, description })),
    };
  });

  app.put<{ Params: { id: string } }>(
    '/api/roles/:id/permissions',
    { preHandler: requirePermission('role.manage') },
    async (req) => {
      const body = parse(rolePermissionsSchema, req.body);
      const role = await prisma.role.findUnique({
        where: { id: req.params.id },
        include: { permissions: { include: { permission: true } } },
      });
      if (!role) throw notFound('Peran tidak ditemukan');
      const unknown = body.permissions.filter((p) => !(p in PERMISSIONS));
      if (unknown.length) throw badRequest(`Izin tidak dikenal: ${unknown.join(', ')}`);
      if (role.code === 'ADMIN' && !body.permissions.includes('role.manage')) {
        throw badRequest('Peran Administrator harus tetap memiliki izin mengelola peran');
      }
      const perms = await prisma.permission.findMany({ where: { code: { in: body.permissions } } });
      await prisma.$transaction(async (tx) => {
        await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
        await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
        await audit(tx, ctxOf(req), {
          action: 'role.permissions_changed',
          entityType: 'Role',
          entityId: role.id,
          before: { permissions: role.permissions.map((p) => p.permission.code) },
          after: { permissions: body.permissions },
        });
      });
      return { ok: true };
    },
  );

  app.get('/api/units', { preHandler: requireAuth }, async () => ({
    items: await prisma.unit.findMany({ orderBy: { name: 'asc' } }),
  }));

  app.post('/api/units', { preHandler: requirePermission('user.manage') }, async (req, reply) => {
    const body = parse(unitSchema, req.body);
    if (await prisma.unit.findUnique({ where: { code: body.code } })) throw conflict('Kode unit sudah dipakai');
    const unit = await prisma.unit.create({ data: body });
    await audit(prisma, ctxOf(req), { action: 'unit.created', entityType: 'Unit', entityId: unit.id, after: body });
    return reply.code(201).send(unit);
  });
}
