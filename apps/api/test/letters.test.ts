import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestContext, login, registerManualLetter, updateSettings, type Session, type TestContext } from './helpers/context';
import { buildTextPdf, SAMPLE_LETTER_LINES } from './helpers/pdf';
import { prisma } from '../src/db';

let ctx: TestContext;
let tu: Session;
const pdf = () => ({ filename: 'surat.pdf', content: buildTextPdf(SAMPLE_LETTER_LINES), contentType: 'application/pdf' });

beforeAll(async () => {
  ctx = await createTestContext();
  tu = await login(ctx.app, 'tu');
});
afterAll(async () => ctx.app.close());

describe('upload validation', () => {
  it('rejects files whose content is not PDF/JPEG/PNG', async () => {
    const res = await client(ctx.app, tu).upload('/api/incoming-letters', {}, [
      { filename: 'virus.pdf', content: Buffer.from('MZ\x90\x00 not a pdf'), contentType: 'application/pdf' },
    ]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/tidak didukung/);
  });

  it('rejects an extension that does not match the content', async () => {
    const res = await client(ctx.app, tu).upload('/api/incoming-letters', {}, [{ ...pdf(), filename: 'surat.png' }]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/tidak sesuai/);
  });

  it('enforces the configured size and page limits', async () => {
    await updateSettings({ maxUploadMb: 1 });
    const big = Buffer.concat([buildTextPdf(['x']), Buffer.alloc(1.2 * 1024 * 1024)]);
    const res = await client(ctx.app, tu).upload('/api/incoming-letters', {}, [{ ...pdf(), content: big }]);
    expect(res.statusCode).toBe(413);
    expect(res.json().error.message).toMatch(/melebihi batas 1 MB/);
    await updateSettings({ maxUploadMb: 15 });
  });

  it('rejects a corrupt PDF and stores nothing', async () => {
    const before = await prisma.document.count();
    const res = await client(ctx.app, tu).upload('/api/incoming-letters', {}, [
      { filename: 'rusak.pdf', content: Buffer.from('%PDF-1.4\ngarbage'), contentType: 'application/pdf' },
    ]);
    expect(res.statusCode).toBe(400);
    expect(await prisma.document.count()).toBe(before);
    expect(await prisma.incomingLetter.count({ where: { documents: { none: {} }, subject: null } })).toBe(0);
  });

  it('accepts PNG and JPEG images', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
    const res = await client(ctx.app, tu).upload('/api/incoming-letters', { metadata: JSON.stringify({ autoExtract: false }) }, [
      { filename: 'scan.png', content: png },
      { filename: 'scan2.jpg', content: jpg },
    ]);
    expect(res.statusCode).toBe(201);
    const docs = await prisma.document.findMany({ where: { incomingLetterId: res.json().id }, orderBy: { createdAt: 'asc' } });
    expect(docs.map((d) => d.kind)).toEqual(['SOURCE', 'ATTACHMENT']);
    expect(docs[0].checksumSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('manual registration (no AI)', () => {
  it('registers a letter manually and assigns an agenda number from the configured format', async () => {
    const api = client(ctx.app, tu);
    const created = await api.upload('/api/incoming-letters', { metadata: JSON.stringify({ subject: 'Surat manual' }) }, []);
    expect(created.statusCode).toBe(201);
    expect(created.json().jobId).toBeNull();
    const id = created.json().id;
    const missing = await api.post(`/api/incoming-letters/${id}/verify`, { subject: 'Surat manual' });
    expect(missing.statusCode).toBe(400);
    const res = await api.post(`/api/incoming-letters/${id}/verify`, {
      letterNumber: 'B-12/X/2026',
      letterDate: '2026-10-05',
      receivedDate: '2026-10-07',
      senderName: 'Kementerian Contoh',
      recipientName: 'Kepala Kantor',
      subject: 'Surat manual',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('REGISTERED');
    expect(res.json().agendaNumber).toMatch(/^\d{4}\/AG\/X\/2026$/);
    const letter = await prisma.incomingLetter.findUniqueOrThrow({ where: { id } });
    expect(letter.processingStatus).toBe('VERIFIED');
    expect(letter.verifiedById).toBe(tu.userId);
    expect(letter.letterNumber).not.toBe(letter.agendaNumber);
    // a second verification is rejected
    expect((await api.post(`/api/incoming-letters/${id}/verify`, { ...res.json(), letterNumber: 'B-12/X/2026', letterDate: '2026-10-05', receivedDate: '2026-10-07', senderName: 'Kementerian Contoh', recipientName: 'Kepala Kantor', subject: 'x' })).statusCode).toBe(409);
  });

  it('agenda numbers are sequential and unique', async () => {
    const a = await registerManualLetter(ctx.app, tu);
    const b = await registerManualLetter(ctx.app, tu);
    const [la, lb] = await Promise.all([a, b].map((id) => prisma.incomingLetter.findUniqueOrThrow({ where: { id } })));
    expect(lb.agendaSeq! - la.agendaSeq!).toBe(1);
  });

  it('detects duplicates by letter number + sender and requires explicit confirmation', async () => {
    await registerManualLetter(ctx.app, tu, { letterNumber: 'DUP/1/2026', senderName: 'Instansi X' });
    const api = client(ctx.app, tu);
    const created = await api.upload('/api/incoming-letters', { metadata: JSON.stringify({ subject: 'dup' }) }, []);
    const body = {
      letterNumber: 'dup/1/2026',
      letterDate: '2026-10-01',
      receivedDate: '2026-10-02',
      senderName: 'instansi x',
      recipientName: 'Kepala',
      subject: 'dup',
    };
    const res = await api.post(`/api/incoming-letters/${created.json().id}/verify`, body);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.duplicates).toHaveLength(1);
    const ok = await api.post(`/api/incoming-letters/${created.json().id}/verify`, { ...body, confirmNotDuplicate: true });
    expect(ok.statusCode).toBe(200);
  });

  it('Idempotency-Key replays the first response instead of creating a second letter', async () => {
    const api = client(ctx.app, tu);
    const before = await prisma.incomingLetter.count();
    const headers = { 'idempotency-key': 'retry-key-123456' };
    const r1 = await api.upload('/api/incoming-letters', { metadata: JSON.stringify({ subject: 'idem' }) }, [], headers);
    const r2 = await api.upload('/api/incoming-letters', { metadata: JSON.stringify({ subject: 'idem' }) }, [], headers);
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect(r2.headers['idempotent-replayed']).toBe('true');
    expect(r2.json().id).toBe(r1.json().id);
    expect(await prisma.incomingLetter.count()).toBe(before + 1);
  });
});

describe('metadata edits and audit trail', () => {
  it('records post-verification corrections field by field', async () => {
    const id = await registerManualLetter(ctx.app, tu, { subject: 'Perihal awal' });
    const api = client(ctx.app, tu);
    const res = await api.patch(`/api/incoming-letters/${id}`, { subject: 'Perihal koreksi', priority: 'TINGGI' });
    expect(res.statusCode).toBe(200);
    const corrections = await prisma.metadataCorrection.findMany({ where: { incomingLetterId: id } });
    expect(corrections.map((c) => [c.field, c.previousValue, c.newValue])).toEqual(
      expect.arrayContaining([['subject', 'Perihal awal', 'Perihal koreksi'], ['priority', 'NORMAL', 'TINGGI']]),
    );
    expect((await api.patch(`/api/incoming-letters/${id}`, { subject: '' })).statusCode).toBe(400);
    const history = await api.get(`/api/incoming-letters/${id}/history`);
    const actions = history.json().items.map((i: { action: string }) => i.action);
    expect(actions).toEqual(expect.arrayContaining(['letter.created', 'letter.verified', 'letter.updated']));
  });

  it('audit log never stores more than a truncated excerpt of long text', async () => {
    const long = 'A'.repeat(2000);
    const id = await registerManualLetter(ctx.app, tu);
    await client(ctx.app, tu).patch(`/api/incoming-letters/${id}`, { summary: long });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: id, action: 'letter.updated' } });
    expect(JSON.stringify(log.after).length).toBeLessThan(600);
  });

  it('cancels a draft (soft delete) with a reason', async () => {
    const api = client(ctx.app, tu);
    const created = await api.upload('/api/incoming-letters', { metadata: JSON.stringify({ subject: 'akan dihapus' }) }, []);
    const id = created.json().id;
    expect((await api.post(`/api/incoming-letters/${id}/cancel`, { reason: 'x' })).statusCode).toBe(400);
    expect((await api.post(`/api/incoming-letters/${id}/cancel`, { reason: 'Salah unggah dokumen' })).statusCode).toBe(200);
    expect((await api.get(`/api/incoming-letters/${id}`)).statusCode).toBe(404);
    const row = await prisma.incomingLetter.findUniqueOrThrow({ where: { id } });
    expect(row.deletedAt).not.toBeNull();
  });
});

describe('search, filter and pagination', () => {
  it('filters by text, status and date range, and paginates', async () => {
    for (let i = 0; i < 5; i++) await registerManualLetter(ctx.app, tu, { subject: `Rapat koordinasi ${i}`, receivedDate: `2026-09-1${i}` });
    const api = client(ctx.app, tu);
    const page1 = await api.get('/api/incoming-letters?q=rapat%20koordinasi&pageSize=2&page=1&sort=receivedDate&order=asc');
    expect(page1.statusCode).toBe(200);
    expect(page1.json().meta).toMatchObject({ page: 1, pageSize: 2, total: 5, totalPages: 3 });
    expect(page1.json().items[0].subject).toBe('Rapat koordinasi 0');
    const page3 = await api.get('/api/incoming-letters?q=rapat%20koordinasi&pageSize=2&page=3&sort=receivedDate&order=asc');
    expect(page3.json().items).toHaveLength(1);
    const range = await api.get('/api/incoming-letters?q=rapat&dateFrom=2026-09-11&dateTo=2026-09-13');
    expect(range.json().meta.total).toBe(3);
    const status = await api.get('/api/incoming-letters?status=REGISTERED&q=rapat');
    expect(status.json().meta.total).toBe(5);
    expect((await api.get('/api/incoming-letters?pageSize=1000')).statusCode).toBe(400);
  });
});
