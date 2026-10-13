import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestContext, login, type TestContext } from './helpers/context';
import { prisma } from '../src/db';
import { hashPassword, verifyPassword } from '../src/lib/crypto';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => ctx.app.close());

describe('password hashing', () => {
  it('hashes with scrypt and verifies', async () => {
    const h = await hashPassword('Rahasia12345');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('Rahasia12345', h)).toBe(true);
    expect(await verifyPassword('salah', h)).toBe(false);
  });
});

describe('authentication', () => {
  it('rejects wrong credentials with a generic message', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'tu', password: 'wrong' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe('Nama pengguna atau kata sandi salah');
    const unknown = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'nobody', password: 'x' } });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().error.message).toBe(res.json().error.message);
  });

  it('logs in with an httpOnly session cookie and returns permissions', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'tu', password: 'DemoPass123' } });
    expect(res.statusCode).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(res.json().user.roles).toEqual(['REGISTRAR']);
    expect(res.json().user.permissions).toContain('letter.verify');
    expect(res.json().csrfToken).toBeTruthy();
  });

  it('requires a session for protected endpoints', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/incoming-letters' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects state-changing requests without a valid CSRF token', async () => {
    const s = await login(ctx.app, 'tu');
    const res = await ctx.app.inject({ method: 'POST', url: '/api/notifications/read-all', headers: { cookie: s.cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CSRF_INVALID');
    const bad = await ctx.app.inject({ method: 'POST', url: '/api/notifications/read-all', headers: { cookie: s.cookie, 'x-csrf-token': 'nope' } });
    expect(bad.statusCode).toBe(403);
    const ok = await client(ctx.app, s).post('/api/notifications/read-all');
    expect(ok.statusCode).toBe(200);
  });

  it('locks the account after 5 failed attempts', async () => {
    for (let i = 0; i < 5; i++) {
      await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'auditor', password: 'bad' } });
    }
    const locked = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'auditor', password: 'DemoPass123' } });
    expect(locked.statusCode).toBe(423);
    const logs = await prisma.auditLog.count({ where: { action: 'auth.account_locked' } });
    expect(logs).toBe(1);
    await prisma.user.update({ where: { username: 'auditor' }, data: { lockedUntil: null } });
  });

  it('logout invalidates the session', async () => {
    const s = await login(ctx.app, 'pegawai1');
    const api = client(ctx.app, s);
    expect((await api.get('/api/auth/me')).statusCode).toBe(200);
    expect((await api.post('/api/auth/logout')).statusCode).toBe(200);
    expect((await api.get('/api/auth/me')).statusCode).toBe(401);
  });

  it('changes password and enforces the password policy', async () => {
    const s = await login(ctx.app, 'pegawai2');
    const api = client(ctx.app, s);
    const weak = await api.post('/api/auth/change-password', { currentPassword: 'DemoPass123', newPassword: 'short' });
    expect(weak.statusCode).toBe(400);
    const ok = await api.post('/api/auth/change-password', { currentPassword: 'DemoPass123', newPassword: 'NewPassword99' });
    expect(ok.statusCode).toBe(200);
    await login(ctx.app, 'pegawai2', 'NewPassword99');
  });

  it('admin-issued reset token works once', async () => {
    const admin = client(ctx.app, await login(ctx.app, 'admin'));
    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'pimpinan' } });
    const res = await admin.post(`/api/users/${user.id}/reset-token`);
    expect(res.statusCode).toBe(200);
    const token = res.json().token;
    const reset = await ctx.app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token, newPassword: 'ResetPass123' } });
    expect(reset.statusCode).toBe(200);
    const again = await ctx.app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token, newPassword: 'ResetPass456' } });
    expect(again.statusCode).toBe(400);
    await login(ctx.app, 'pimpinan', 'ResetPass123');
    // stored token is hashed, never the raw value
    expect(await prisma.passwordResetToken.count({ where: { id: token } })).toBe(0);
  });
});
