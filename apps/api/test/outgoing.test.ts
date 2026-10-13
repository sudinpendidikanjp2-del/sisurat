import PizZip from 'pizzip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestContext, login, registerManualLetter, type Session, type TestContext } from './helpers/context';
import { prisma } from '../src/db';
import { buildDocx } from '../src/docx/sampleTemplates';
import { detectPlaceholders } from '../src/docx/render';

let ctx: TestContext;
let tu: Session, leader: Session, staff1: Session, admin: Session;

function docxText(buf: Buffer) {
  return new PizZip(buf).file('word/document.xml')!.asText().replace(/<[^>]+>/g, '');
}

async function template(type: string) {
  return prisma.documentTemplate.findFirstOrThrow({ where: { type: type as never, isActive: true }, orderBy: { version: 'desc' } });
}

beforeAll(async () => {
  ctx = await createTestContext();
  [tu, leader, staff1, admin] = await Promise.all(['tu', 'pimpinan', 'pegawai1', 'admin'].map((u) => login(ctx.app, u)));
});
afterAll(async () => ctx.app.close());

describe('templates', () => {
  it('provides sample templates for all five letter types', async () => {
    const res = await client(ctx.app, staff1).get('/api/templates?active=true');
    expect(res.statusCode).toBe(200);
    const types = new Set(res.json().items.map((t: { type: string }) => t.type));
    expect([...types].sort()).toEqual(['KETERANGAN', 'NOTA_DINAS', 'PENGANTAR', 'TUGAS', 'UNDANGAN']);
  });

  it('detects placeholders even when Word splits them across runs', () => {
    const zip = new PizZip(buildDocx(['x']));
    zip.file('word/document.xml', zip.file('word/document.xml')!.asText().replace('<w:t xml:space="preserve">x</w:t>', '<w:t>{nama_</w:t></w:r><w:r><w:t>pegawai}</w:t>'));
    expect(detectPlaceholders(zip.generate({ type: 'nodebuffer' }))).toEqual(['nama_pegawai']);
  });

  it('uploading a new template creates a new version; only admins can upload', async () => {
    const file = buildDocx(['{nomor}', 'Kepada {tujuan}', '{isi_surat}']);
    const up = (s: Session) =>
      client(ctx.app, s).upload('/api/templates', { type: 'PENGANTAR', name: 'Surat Pengantar Resmi' }, [{ filename: 'pengantar.docx', content: file }], {}, 'file');
    expect((await up(tu)).statusCode).toBe(403);
    const res = await up(admin);
    expect(res.statusCode).toBe(201);
    expect(res.json().version).toBe(2);
    expect(res.json().placeholders.map((p: { key: string }) => p.key)).toEqual(['tujuan', 'isi_surat']);
    const bad = await client(ctx.app, admin).upload('/api/templates', { type: 'PENGANTAR', name: 'x x x' }, [{ filename: 'a.pdf', content: Buffer.from('%PDF-1.4') }], {}, 'file');
    expect(bad.statusCode).toBe(400);
  });
});

describe('outgoing letter lifecycle (AT-09)', () => {
  it('validates required placeholders', async () => {
    const t = await template('UNDANGAN');
    const res = await client(ctx.app, staff1).post('/api/outgoing-letters', { templateId: t.id, subject: 'Undangan', recipient: 'Para Kepala Seksi', data: { acara: 'Rapat' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/Field wajib belum diisi/);
  });

  it('draft → review → approve → final number, with template version and linked incoming letter recorded', async () => {
    const incoming = await registerManualLetter(ctx.app, tu);
    const t = await template('UNDANGAN');
    const data = {
      acara: 'Rapat Evaluasi',
      tempat_tanggal_surat: 'Kota Contoh, 13 Oktober 2026',
      tujuan: 'Para Kepala Seksi',
      hari_tanggal: 'Senin, 20 Oktober 2026',
      waktu: '09.00 WIB',
      tempat: 'Ruang Rapat',
      agenda: 'Evaluasi program',
      penandatangan_jabatan: 'Kepala Kantor',
      penandatangan_nama: 'Budi Santoso',
    };
    const S = client(ctx.app, tu);
    const created = await S.post('/api/outgoing-letters', { templateId: t.id, subject: 'Undangan Rapat Evaluasi', recipient: 'Para Kepala Seksi', data, incomingLetterIds: [incoming] });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    const out = await prisma.outgoingLetter.findUniqueOrThrow({ where: { id }, include: { documents: true, links: true } });
    expect(out.templateVersion).toBe(t.version);
    expect(out.number).toBeNull();
    expect(out.links.map((l) => l.incomingLetterId)).toEqual([incoming]);
    const draftDoc = out.documents[0];
    const draft = await S.get(`/api/documents/${draftDoc.id}/content`);
    expect(draft.statusCode).toBe(200);
    expect(draft.headers['content-disposition']).toMatch(/^attachment/);
    const text = docxText(draft.rawPayload);
    expect(text).toContain('Rapat Evaluasi');
    expect(text).toContain('[nomor diberikan saat finalisasi]');
    expect(text).toContain('Instansi Contoh');
    expect(text).not.toMatch(/\{[a-z_]+\}/);

    // cannot finalize before approval; creator cannot approve
    expect((await S.post(`/api/outgoing-letters/${id}/finalize`)).statusCode).toBe(409);
    expect((await S.post(`/api/outgoing-letters/${id}/submit`)).statusCode).toBe(200);
    expect(await prisma.notification.count({ where: { userId: leader.userId, type: 'OUTGOING_REVIEW_REQUESTED' } })).toBe(1);
    expect((await S.patch(`/api/outgoing-letters/${id}`, { subject: 'Ubah setelah diajukan' })).statusCode).toBe(409);

    const L = client(ctx.app, leader);
    expect((await L.post(`/api/outgoing-letters/${id}/review`, { decision: 'REQUEST_REVISION', note: 'Perbaiki waktu' })).statusCode).toBe(200);
    expect((await S.patch(`/api/outgoing-letters/${id}`, { data: { ...data, waktu: '10.00 WIB' } })).statusCode).toBe(200);
    expect(await prisma.document.count({ where: { outgoingLetterId: id } })).toBe(2); // previous version kept
    await S.post(`/api/outgoing-letters/${id}/submit`);
    expect((await L.post(`/api/outgoing-letters/${id}/review`, { decision: 'APPROVE' })).statusCode).toBe(200);

    expect((await client(ctx.app, staff1).post(`/api/outgoing-letters/${id}/finalize`)).statusCode).toBe(403);
    const fin = await S.post(`/api/outgoing-letters/${id}/finalize`);
    expect(fin.statusCode).toBe(200);
    expect(fin.json().number).toMatch(/^001\/UND\/[IVX]+\/\d{4}$/);
    const finalDoc = await prisma.document.findFirstOrThrow({ where: { outgoingLetterId: id }, orderBy: { version: 'desc' } });
    expect(finalDoc.version).toBe(3);
    const finalText = docxText(await ctx.deps.storage.read(finalDoc.storageKey));
    expect(finalText).toContain(fin.json().number);
    expect(finalText).toContain('10.00 WIB');
    const actions = (await prisma.auditLog.findMany({ where: { entityId: id } })).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['outgoing.created', 'outgoing.submitted', 'outgoing.revision_requested', 'outgoing.updated', 'outgoing.approved', 'outgoing.finalized']));
  });

  it('staff can draft a reply linked to their disposition', async () => {
    const incoming = await registerManualLetter(ctx.app, tu);
    await client(ctx.app, tu).post(`/api/incoming-letters/${incoming}/forward`, { leaderId: leader.userId });
    const d = await client(ctx.app, leader).post(`/api/incoming-letters/${incoming}/dispositions`, { instruction: 'Buat surat balasan', assigneeIds: [staff1.userId] });
    const t = await template('NOTA_DINAS');
    const data = Object.fromEntries((t.placeholders as { key: string }[]).map((p) => [p.key, `nilai ${p.key}`]));
    const res = await client(ctx.app, staff1).post('/api/outgoing-letters', { templateId: t.id, subject: 'Balasan', recipient: 'Pimpinan', data, dispositionId: d.json().id });
    expect(res.statusCode).toBe(201);
    const out = await prisma.outgoingLetter.findUniqueOrThrow({ where: { id: res.json().id }, include: { links: true } });
    expect(out.dispositionId).toBe(d.json().id);
    expect(out.links.map((l) => l.incomingLetterId)).toEqual([incoming]);
    const detail = await client(ctx.app, staff1).get(`/api/assignments/${d.json().assignments[0]}`);
    expect(detail.json().disposition.outgoingLetters).toHaveLength(1);
  });
});
