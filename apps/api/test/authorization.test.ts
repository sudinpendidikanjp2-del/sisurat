import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestContext, login, registerManualLetter, type Session, type TestContext } from './helpers/context';
import { buildTextPdf, SAMPLE_LETTER_LINES } from './helpers/pdf';
import { prisma } from '../src/db';

let ctx: TestContext;
let tu: Session, leader: Session, staff1: Session, staff2: Session, auditor: Session, admin: Session;

beforeAll(async () => {
  ctx = await createTestContext();
  [tu, leader, staff1, staff2, auditor, admin] = await Promise.all(
    ['tu', 'pimpinan', 'pegawai1', 'pegawai2', 'auditor', 'admin'].map((u) => login(ctx.app, u)),
  );
});
afterAll(async () => ctx.app.close());

describe('role permissions (enforced server-side)', () => {
  it('only registrars can create letters', async () => {
    for (const s of [staff1, auditor, admin]) {
      const res = await client(ctx.app, s).upload('/api/incoming-letters', { metadata: JSON.stringify({ subject: 'x' }) }, []);
      expect(res.statusCode).toBe(403);
    }
  });

  it('auditor can read but cannot modify', async () => {
    const id = await registerManualLetter(ctx.app, tu);
    const api = client(ctx.app, auditor);
    expect((await api.get(`/api/incoming-letters/${id}`)).statusCode).toBe(200);
    expect((await api.patch(`/api/incoming-letters/${id}`, { subject: 'Ubah' })).statusCode).toBe(403);
    expect((await api.post(`/api/incoming-letters/${id}/archive`)).statusCode).toBe(403);
    expect((await api.get('/api/audit-logs')).statusCode).toBe(200);
  });

  it('administrator does not automatically read letter contents', async () => {
    const id = await registerManualLetter(ctx.app, tu);
    const api = client(ctx.app, admin);
    expect((await api.get(`/api/incoming-letters/${id}`)).statusCode).toBe(404);
    const list = await api.get('/api/incoming-letters');
    expect(list.json().items).toHaveLength(0);
    expect((await api.get('/api/users')).statusCode).toBe(200);
  });

  it('staff only see letters they are assigned to', async () => {
    const id = await registerManualLetter(ctx.app, tu);
    expect((await client(ctx.app, staff1).get(`/api/incoming-letters/${id}`)).statusCode).toBe(404);
    await client(ctx.app, tu).post(`/api/incoming-letters/${id}/forward`, { leaderId: leader.userId });
    const d = await client(ctx.app, leader).post(`/api/incoming-letters/${id}/dispositions`, {
      instruction: 'Tindak lanjuti',
      assigneeIds: [staff1.userId],
    });
    expect(d.statusCode).toBe(201);
    expect((await client(ctx.app, staff1).get(`/api/incoming-letters/${id}`)).statusCode).toBe(200);
    expect((await client(ctx.app, staff2).get(`/api/incoming-letters/${id}`)).statusCode).toBe(404);
  });

  it('confidential letters are hidden from users without letter.read_confidential', async () => {
    const id = await registerManualLetter(ctx.app, tu, { confidentiality: 'RAHASIA' });
    expect((await client(ctx.app, tu).get(`/api/incoming-letters/${id}`)).statusCode).toBe(200); // creator
    expect((await client(ctx.app, auditor).get(`/api/incoming-letters/${id}`)).statusCode).toBe(404);
    expect((await client(ctx.app, leader).get(`/api/incoming-letters/${id}`)).statusCode).toBe(200);
  });

  it('private documents are only downloadable within scope and downloads are audited', async () => {
    const res = await client(ctx.app, tu).upload(
      '/api/incoming-letters',
      { metadata: JSON.stringify({ autoExtract: false }) },
      [{ filename: 'surat.pdf', content: buildTextPdf(SAMPLE_LETTER_LINES), contentType: 'application/pdf' }],
    );
    expect(res.statusCode).toBe(201);
    const docId = res.json().documents[0];
    const own = await client(ctx.app, tu).get(`/api/documents/${docId}/content`);
    expect(own.statusCode).toBe(200);
    expect(own.headers['content-type']).toBe('application/pdf');
    expect(own.headers['cache-control']).toContain('no-store');
    expect(own.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await client(ctx.app, staff1).get(`/api/documents/${docId}/content`)).statusCode).toBe(404);
    expect((await client(ctx.app, null).get(`/api/documents/${docId}/content`)).statusCode).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'document.viewed', entityId: docId } })).toBe(1);
    // storage key is never exposed in API responses
    const detail = await client(ctx.app, tu).get(`/api/incoming-letters/${res.json().id}`);
    expect(detail.body).not.toContain('storageKey');
  });

  it('only administrators manage users, roles and settings', async () => {
    for (const s of [tu, leader, auditor]) {
      const api = client(ctx.app, s);
      expect((await api.get('/api/users')).statusCode).toBe(403);
      expect((await api.get('/api/settings')).statusCode).toBe(403);
      expect((await api.get('/api/ai-providers')).statusCode).toBe(403);
    }
  });

  it('role permission changes take effect and are audited', async () => {
    const api = client(ctx.app, admin);
    const roles = (await api.get('/api/roles')).json().items as { id: string; code: string; permissions: string[] }[];
    const auditorRole = roles.find((r) => r.code === 'AUDITOR')!;
    const res = await api.put(`/api/roles/${auditorRole.id}/permissions`, { permissions: [...auditorRole.permissions, 'report.export'] });
    expect(res.statusCode).toBe(200);
    expect((await client(ctx.app, auditor).get('/api/reports/letters.csv')).statusCode).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'role.permissions_changed' } })).toBe(1);
  });

  it('provider configuration never exposes API keys', async () => {
    const res = await client(ctx.app, admin).get('/api/ai-providers');
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toMatch(/apiKey|API_KEY/i);
    expect(res.json().items[0]).toHaveProperty('credentialConfigured');
  });
});
