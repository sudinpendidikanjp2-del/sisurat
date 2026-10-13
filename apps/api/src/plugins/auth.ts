import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Permission, RoleCode } from '@sisurat/shared';
import type { Deps } from '../lib/deps';
import type { AuthUser } from '../lib/context';
import { safeEqual, sha256 } from '../lib/crypto';
import { AppError, forbidden, unauthorized } from '../lib/errors';
import { env } from '../config/env';
import type { Db } from '../db';

export const SESSION_COOKIE = 'sisurat_sid';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Endpoints reachable without a session (CSRF does not apply: no ambient credentials yet). */
const PUBLIC_MUTATIONS = new Set(['/api/auth/login', '/api/auth/reset-password']);

export async function loadAuthUser(prisma: Db, userId: string): Promise<AuthUser | null> {
  const user = await prisma.user.findFirst({
    where: { id: userId, isActive: true, deletedAt: null },
    include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
  });
  if (!user) return null;
  const permissions = new Set<Permission>();
  for (const ur of user.roles) for (const rp of ur.role.permissions) permissions.add(rp.permission.code as Permission);
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    position: user.position,
    unitId: user.unitId,
    roles: user.roles.map((r) => r.role.code as RoleCode),
    permissions,
    mustChangePassword: user.mustChangePassword,
  };
}

async function authPlugin(app: FastifyInstance, deps: Deps) {
  const { prisma } = deps;

  app.addHook('onRequest', async (req: FastifyRequest) => {
    if (!req.url.startsWith('/api/')) return;
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const id = sha256(token);
      const session = await prisma.session.findUnique({ where: { id } });
      if (session && session.expiresAt > new Date()) {
        const user = await loadAuthUser(prisma, session.userId);
        if (user) {
          req.user = user;
          req.sessionId = session.id;
          req.csrfToken = session.csrfToken;
          // Sliding expiration, written at most every 5 minutes.
          if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
            await prisma.session.update({
              where: { id },
              data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + env.SESSION_TTL_HOURS * 3600_000) },
            });
          }
        }
      }
    }

    if (!SAFE_METHODS.has(req.method)) {
      const path = req.url.split('?')[0];
      if (PUBLIC_MUTATIONS.has(path)) return;
      if (!req.user) throw unauthorized();
      const header = req.headers['x-csrf-token'];
      if (typeof header !== 'string' || !req.csrfToken || !safeEqual(header, req.csrfToken)) {
        throw new AppError(403, 'CSRF_INVALID', 'Token keamanan tidak valid. Muat ulang halaman lalu coba lagi.');
      }
    }
  });
}

export default fp(authPlugin, { name: 'auth' });

export const requireAuth: preHandlerHookHandler = async (req) => {
  if (!req.user) throw unauthorized();
};

/** Route guard: user must hold at least one of the given permissions. */
export function requirePermission(...permissions: Permission[]): preHandlerHookHandler {
  return async (req) => {
    if (!req.user) throw unauthorized();
    if (!permissions.some((p) => req.user!.permissions.has(p))) throw forbidden();
  };
}
