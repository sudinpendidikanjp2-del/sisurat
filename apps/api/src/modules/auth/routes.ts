import type { FastifyInstance, FastifyRequest } from 'fastify';
import { changePasswordSchema, loginSchema, resetPasswordSchema } from '@sisurat/shared';
import type { Deps } from '../../lib/deps';
import { hashPassword, randomToken, sha256, verifyPassword } from '../../lib/crypto';
import { AppError, badRequest } from '../../lib/errors';
import { ctxOf, parse, requireUser } from '../../lib/http';
import { audit } from '../../lib/audit';
import { env } from '../../config/env';
import { SESSION_COOKIE, loadAuthUser, requireAuth } from '../../plugins/auth';
import type { AuthUser } from '../../lib/context';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
// Pre-computed hash used to keep timing similar when the username does not exist.
let dummyHash: Promise<string> | null = null;

export function serializeAuthUser(user: AuthUser) {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    position: user.position,
    roles: user.roles,
    permissions: [...user.permissions].sort(),
    mustChangePassword: user.mustChangePassword,
  };
}

export default async function authRoutes(app: FastifyInstance, deps: Deps) {
  const { prisma } = deps;

  app.post(
    '/api/auth/login',
    {
      config: {
        // Keyed by IP + username so many staff behind one office NAT are not blocked together;
        // per-account lockout below stops password guessing on a single account.
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes',
          hook: 'preHandler',
          keyGenerator: (req: FastifyRequest) =>
            `${req.ip}:${String((req.body as { username?: unknown } | undefined)?.username ?? '').toLowerCase().slice(0, 100)}`,
        },
      },
    },
    async (req, reply) => {
      const body = parse(loginSchema, req.body);
      const username = body.username.toLowerCase();
      const user = await prisma.user.findUnique({ where: { username } });
      const sysCtx = { system: 'auth', ip: undefined, userAgent: undefined } as const;

      if (!user || !user.isActive || user.deletedAt) {
        dummyHash ??= hashPassword('dummy-password-for-timing');
        await verifyPassword(body.password, await dummyHash);
        await audit(prisma, sysCtx, {
          action: 'auth.login_failed',
          entityType: 'User',
          summary: `Login gagal untuk "${username.slice(0, 50)}" dari ${req.ip}`,
        });
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Nama pengguna atau kata sandi salah');
      }

      if (user.lockedUntil && user.lockedUntil > new Date()) {
        throw new AppError(
          423,
          'ACCOUNT_LOCKED',
          'Akun dikunci sementara karena terlalu banyak percobaan gagal. Coba lagi beberapa menit lagi.',
        );
      }

      const ok = await verifyPassword(body.password, user.passwordHash);
      if (!ok) {
        const failed = user.failedLoginCount + 1;
        const lock = failed >= MAX_FAILED;
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: lock ? 0 : failed,
            lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
          },
        });
        await audit(prisma, sysCtx, {
          action: lock ? 'auth.account_locked' : 'auth.login_failed',
          entityType: 'User',
          entityId: user.id,
          summary: `Login gagal (${failed}x) dari ${req.ip}`,
        });
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Nama pengguna atau kata sandi salah');
      }

      const token = randomToken(32);
      const csrfToken = randomToken(24);
      const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3600_000);
      await prisma.$transaction([
        prisma.session.create({
          data: {
            id: sha256(token),
            userId: user.id,
            csrfToken,
            ip: req.ip,
            userAgent: req.headers['user-agent']?.slice(0, 300),
            expiresAt,
          },
        }),
        prisma.user.update({
          where: { id: user.id },
          data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
        }),
      ]);
      const authUser = (await loadAuthUser(prisma, user.id))!;
      await audit(prisma, { user: authUser, ip: req.ip, userAgent: req.headers['user-agent'] }, {
        action: 'auth.login',
        entityType: 'User',
        entityId: user.id,
      });

      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: env.COOKIE_SECURE,
        sameSite: 'lax',
        path: '/',
        expires: expiresAt,
      });
      return { user: serializeAuthUser(authUser), csrfToken };
    },
  );

  app.post('/api/auth/logout', { preHandler: requireAuth }, async (req, reply) => {
    if (req.sessionId) await prisma.session.delete({ where: { id: req.sessionId } }).catch(() => undefined);
    await audit(prisma, ctxOf(req), { action: 'auth.logout', entityType: 'User', entityId: req.user!.id });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    const user = requireUser(req);
    return { user: serializeAuthUser(user), csrfToken: req.csrfToken };
  });

  app.post('/api/auth/change-password', { preHandler: requireAuth }, async (req) => {
    const user = requireUser(req);
    const body = parse(changePasswordSchema, req.body);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await verifyPassword(body.currentPassword, row.passwordHash))) {
      throw badRequest('Kata sandi lama salah');
    }
    if (body.currentPassword === body.newPassword) throw badRequest('Kata sandi baru harus berbeda');
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(body.newPassword), mustChangePassword: false },
      }),
      // Invalidate all other sessions.
      prisma.session.deleteMany({ where: { userId: user.id, NOT: { id: req.sessionId } } }),
    ]);
    await audit(prisma, ctxOf(req), { action: 'auth.password_changed', entityType: 'User', entityId: user.id });
    return { ok: true };
  });

  /** Completes a one-time reset link issued by an administrator (POST /api/users/:id/reset-token). */
  app.post(
    '/api/auth/reset-password',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req) => {
      const body = parse(resetPasswordSchema, req.body);
      const id = sha256(body.token);
      const token = await prisma.passwordResetToken.findUnique({ where: { id } });
      if (!token || token.usedAt || token.expiresAt < new Date()) {
        throw badRequest('Tautan reset tidak valid atau sudah kedaluwarsa');
      }
      await prisma.$transaction([
        prisma.user.update({
          where: { id: token.userId },
          data: {
            passwordHash: await hashPassword(body.newPassword),
            mustChangePassword: false,
            failedLoginCount: 0,
            lockedUntil: null,
          },
        }),
        prisma.passwordResetToken.update({ where: { id }, data: { usedAt: new Date() } }),
        prisma.session.deleteMany({ where: { userId: token.userId } }),
      ]);
      await audit(prisma, { system: 'auth' }, {
        action: 'auth.password_reset',
        entityType: 'User',
        entityId: token.userId,
      });
      return { ok: true };
    },
  );
}
