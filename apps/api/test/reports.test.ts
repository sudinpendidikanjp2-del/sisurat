import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestContext, login, registerManualLetter, type Session, type TestContext } from './helpers/context';
import { prisma } from '../src/db';

let ctx: TestContext;
let tu: Session, staff1: Session, auditor: Session, admin: Session;

beforeAll(async () => {
  ctx = await createTestContext();
  [tu, staff1, auditor, admin] = await Promise.all(['tu', 'pegawai1', 'auditor', 'admin'].map((u) => login(ctx.app, u)));
});
afterAll(async () => ctx.app.close());

describe('dashboard', () => {
  it('shows zeros (empty state) for an empty database', async () => {
    const res = await client(ctx.app, tu).get('/api/dashboard');
    expect(res.statusCode).toBe(200);
    expect(res.json().counts.totalIncoming).toBe(0);
    expect(res.json().averages.registrationHours).toBeNull();
    expect(res.json().ai.estimatedCostUsd).toBeNull();
  });

  it('counts real data from the database within the user scope', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await registerManualLetter(ctx.app, tu, { receivedDate: today });
    await registerManualLetter(ctx.app, tu, { receivedDate: today });
    await client(ctx.app, tu).upload('/api/incoming-letters', { metadata: JSON.stringify({ subject: 'Draft' }) }, []);
    const res = await client(ctx.app, tu).get('/api/dashboard');
    expect(res.json().counts.totalIncoming).toBe(3);
    expect(res.json().counts.awaitingVerification).toBe(1);
    expect(res.json().averages.registrationHours).not.toBeNull();
    // staff sees nothing they are not involved in
    const staff = await client(ctx.app, staff1).get('/api/dashboard');
    expect(staff.json().counts.totalIncoming).toBe(0);
  });
});

describe('reports and export', () => {
  it('summarises letters and requires report.read', async () => {
    await registerManualLetter(ctx.app, tu, { senderName: '=cmd|calc', letterType: 'UNDANGAN' });
    const res = await client(ctx.app, tu).get('/api/reports/letters');
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBeGreaterThan(0);
    expect(res.json().byType).toContainEqual({ type: 'UNDANGAN', count: 1 });
    expect((await client(ctx.app, staff1).get('/api/reports/letters')).statusCode).toBe(403);
  });

  it('exports CSV safely and audits the export', async () => {
    const res = await client(ctx.app, tu).get('/api/reports/letters.csv');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.body).toContain("'=cmd|calc");
    expect(res.body).not.toMatch(/,=cmd/);
    expect(await prisma.auditLog.count({ where: { action: 'report.exported' } })).toBe(1);
    expect((await client(ctx.app, auditor).get('/api/reports/letters.csv')).statusCode).toBe(403);
  });
});

describe('audit log', () => {
  it('is readable by auditors/admins only and filterable', async () => {
    expect((await client(ctx.app, tu).get('/api/audit-logs')).statusCode).toBe(403);
    const res = await client(ctx.app, admin).get('/api/audit-logs?action=letter.verified&pageSize=5');
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeGreaterThan(0);
    expect(res.json().items.every((i: { action: string }) => i.action.includes('letter.verified'))).toBe(true);
    expect(res.json().items[0].actor.fullName).toBeTruthy();
  });

  it('settings changes are validated and audited', async () => {
    const api = client(ctx.app, admin);
    const current = (await api.get('/api/settings')).json();
    expect((await api.put('/api/settings', { ...current, agendaNumberFormat: 'TANPA-SEQ' })).statusCode).toBe(400);
    expect((await api.put('/api/settings', { ...current, organizationName: 'Kantor Uji' })).statusCode).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'settings.updated' } })).toBe(1);
  });
});
