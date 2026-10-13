import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestContext, login, registerManualLetter, type Session, type TestContext } from './helpers/context';
import { buildTextPdf } from './helpers/pdf';
import { prisma } from '../src/db';
import { scanDeadlines } from '../src/jobs/maintenance';

let ctx: TestContext;
let tu: Session, leader: Session, staff1: Session, staff2: Session;

const status = async (id: string) => (await prisma.incomingLetter.findUniqueOrThrow({ where: { id } })).status;

async function forwardAndDispose(assignees: string[], dueDate?: string) {
  const id = await registerManualLetter(ctx.app, tu);
  const fwd = await client(ctx.app, tu).post(`/api/incoming-letters/${id}/forward`, { leaderId: leader.userId, note: 'Mohon arahan' });
  expect(fwd.statusCode).toBe(200);
  const d = await client(ctx.app, leader).post(`/api/incoming-letters/${id}/dispositions`, {
    instruction: 'Siapkan bahan dan hadiri rapat',
    priority: 'TINGGI',
    dueDate,
    assigneeIds: assignees,
  });
  expect(d.statusCode).toBe(201);
  return { letterId: id, dispositionId: d.json().id as string, assignmentIds: d.json().assignments as string[] };
}

beforeAll(async () => {
  ctx = await createTestContext();
  [tu, leader, staff1, staff2] = await Promise.all(['tu', 'pimpinan', 'pegawai1', 'pegawai2'].map((u) => login(ctx.app, u)));
});
afterAll(async () => ctx.app.close());

describe('forwarding', () => {
  it('only forwards to officials who can issue dispositions', async () => {
    const id = await registerManualLetter(ctx.app, tu);
    const bad = await client(ctx.app, tu).post(`/api/incoming-letters/${id}/forward`, { leaderId: staff1.userId });
    expect(bad.statusCode).toBe(400);
    const ok = await client(ctx.app, tu).post(`/api/incoming-letters/${id}/forward`, { leaderId: leader.userId });
    expect(ok.statusCode).toBe(200);
    expect(await status(id)).toBe('AWAITING_DISPOSITION');
    const notif = await prisma.notification.findFirst({ where: { userId: leader.userId, type: 'LETTER_FORWARDED', entityId: id } });
    expect(notif).not.toBeNull();
  });

  it('cannot dispose a draft letter', async () => {
    const created = await client(ctx.app, tu).upload('/api/incoming-letters', { metadata: JSON.stringify({ subject: 'draft' }) }, []);
    const res = await client(ctx.app, leader).post(`/api/incoming-letters/${created.json().id}/dispositions`, { instruction: 'x x x', assigneeIds: [staff1.userId] });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INVALID_STATE');
  });
});

describe('full follow-up flow (AT-08)', () => {
  it('assign → progress with evidence → submit → revision → resubmit → approve → completed → archived', async () => {
    const { letterId, assignmentIds } = await forwardAndDispose([staff1.userId], '2030-01-31');
    const [aid] = assignmentIds;
    expect(await status(letterId)).toBe('ASSIGNED');
    expect(await prisma.notification.count({ where: { userId: staff1.userId, type: 'DISPOSITION_ASSIGNED' } })).toBe(1);

    const s1 = client(ctx.app, staff1);
    // other staff cannot touch the assignment
    expect((await client(ctx.app, staff2).post(`/api/assignments/${aid}/updates`, { note: 'hack' })).statusCode).toBe(403);
    expect((await client(ctx.app, staff2).get(`/api/assignments/${aid}`)).statusCode).toBe(404);

    expect((await s1.post(`/api/assignments/${aid}/start`)).statusCode).toBe(200);
    expect(await status(letterId)).toBe('IN_PROGRESS');

    const progress = await s1.upload(
      `/api/assignments/${aid}/updates`,
      { note: 'Bahan rapat sedang disusun', progressPercent: '50' },
      [{ filename: 'bukti.pdf', content: buildTextPdf(['Bukti kegiatan']) }],
    );
    expect(progress.statusCode).toBe(201);
    const evidence = await prisma.document.findFirstOrThrow({ where: { workUpdateId: progress.json().id } });
    expect(evidence.kind).toBe('EVIDENCE');
    // issuer can read evidence; unrelated staff cannot
    expect((await client(ctx.app, leader).get(`/api/documents/${evidence.id}/content`)).statusCode).toBe(200);
    expect((await client(ctx.app, staff2).get(`/api/documents/${evidence.id}/content`)).statusCode).toBe(404);

    // submitting does not complete the task
    expect((await s1.post(`/api/assignments/${aid}/updates`, { note: 'Selesai disusun', progressPercent: 100, submitForReview: true })).statusCode).toBe(201);
    const a = await prisma.assignment.findUniqueOrThrow({ where: { id: aid } });
    expect(a.status).toBe('WAITING_REVIEW');
    expect(await status(letterId)).toBe('WAITING_REVIEW');

    // assignee cannot approve their own work
    expect((await s1.post(`/api/assignments/${aid}/review`, { decision: 'APPROVE' })).statusCode).toBe(403);

    const L = client(ctx.app, leader);
    expect((await L.post(`/api/assignments/${aid}/review`, { decision: 'REQUEST_REVISION' })).statusCode).toBe(400);
    expect((await L.post(`/api/assignments/${aid}/review`, { decision: 'REQUEST_REVISION', note: 'Lengkapi daftar hadir' })).statusCode).toBe(200);
    expect(await status(letterId)).toBe('NEEDS_REVISION');
    expect(await prisma.notification.count({ where: { userId: staff1.userId, type: 'REVISION_REQUESTED' } })).toBe(1);

    await s1.post(`/api/assignments/${aid}/updates`, { note: 'Daftar hadir dilampirkan', submitForReview: true });
    expect((await L.post(`/api/assignments/${aid}/review`, { decision: 'APPROVE', note: 'Baik' })).statusCode).toBe(200);
    const done = await prisma.assignment.findUniqueOrThrow({ where: { id: aid }, include: { disposition: true, updates: { orderBy: { createdAt: 'asc' } } } });
    expect(done.status).toBe('COMPLETED');
    expect(done.disposition.status).toBe('COMPLETED');
    expect(done.updates.map((u) => u.type)).toEqual(['STARTED', 'PROGRESS', 'SUBMITTED', 'REVISION_REQUESTED', 'SUBMITTED', 'APPROVED']);
    expect(await status(letterId)).toBe('COMPLETED');

    expect((await client(ctx.app, tu).post(`/api/incoming-letters/${letterId}/archive`, { note: 'Selesai' })).statusCode).toBe(200);
    expect(await status(letterId)).toBe('ARCHIVED');
    const actions = (await prisma.auditLog.findMany({ where: { OR: [{ entityId: letterId }, { entityId: aid }] } })).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['letter.forwarded', 'assignment.started', 'assignment.submitted', 'assignment.revision_requested', 'assignment.approved', 'letter.archived']));
  });

  it('with several assignees the letter completes only when all are approved', async () => {
    const { letterId, dispositionId } = await forwardAndDispose([staff1.userId, staff2.userId]);
    const byUser = async (userId: string) => (await prisma.assignment.findFirstOrThrow({ where: { dispositionId, assigneeId: userId } })).id;
    const a1 = await byUser(staff1.userId);
    const a2 = await byUser(staff2.userId);
    await client(ctx.app, staff1).post(`/api/assignments/${a1}/updates`, { note: 'ok', submitForReview: true });
    await client(ctx.app, leader).post(`/api/assignments/${a1}/review`, { decision: 'APPROVE' });
    expect(await status(letterId)).toBe('ASSIGNED');
    await client(ctx.app, staff2).post(`/api/assignments/${a2}/updates`, { note: 'ok', submitForReview: true });
    await client(ctx.app, leader).post(`/api/assignments/${a2}/review`, { decision: 'APPROVE' });
    expect(await status(letterId)).toBe('COMPLETED');
  });

  it('reassignment keeps the history of the previous assignee', async () => {
    const { assignmentIds } = await forwardAndDispose([staff1.userId]);
    const res = await client(ctx.app, leader).post(`/api/assignments/${assignmentIds[0]}/reassign`, { newAssigneeId: staff2.userId, reason: 'Pegawai cuti' });
    expect(res.statusCode).toBe(201);
    const old = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentIds[0] }, include: { reassignedTo: true } });
    expect(old.status).toBe('CANCELLED');
    expect(old.reassignedTo?.assigneeId).toBe(staff2.userId);
    expect((await client(ctx.app, staff2).get(`/api/assignments/${res.json().id}`)).statusCode).toBe(200);
  });

  it('cancellation requires a reason and is audited', async () => {
    const { assignmentIds, letterId } = await forwardAndDispose([staff1.userId]);
    expect((await client(ctx.app, leader).post(`/api/assignments/${assignmentIds[0]}/cancel`, { reason: '' })).statusCode).toBe(400);
    expect((await client(ctx.app, leader).post(`/api/assignments/${assignmentIds[0]}/cancel`, { reason: 'Tidak lagi relevan' })).statusCode).toBe(200);
    expect(await status(letterId)).toBe('AWAITING_DISPOSITION');
    expect(await prisma.auditLog.count({ where: { action: 'assignment.cancelled', entityId: assignmentIds[0] } })).toBe(1);
  });

  it('lists my tasks and the review queue', async () => {
    const mine = await client(ctx.app, staff1).get('/api/assignments?scope=mine');
    expect(mine.statusCode).toBe(200);
    expect(mine.json().items.every((a: { assigneeId: string }) => a.assigneeId === staff1.userId)).toBe(true);
    expect((await client(ctx.app, staff1).get('/api/assignments?scope=review')).statusCode).toBe(403);
    expect((await client(ctx.app, leader).get('/api/assignments?scope=review&status=WAITING_REVIEW')).statusCode).toBe(200);
  });
});

describe('deadline notifications', () => {
  it('creates approaching/overdue notifications once (deduplicated)', async () => {
    const { assignmentIds } = await forwardAndDispose([staff2.userId], '2030-06-10');
    await prisma.assignment.update({ where: { id: assignmentIds[0] }, data: { dueDate: new Date('2026-01-01T00:00:00Z') } });
    const first = await scanDeadlines(prisma, new Date('2026-01-05T08:00:00Z'));
    const second = await scanDeadlines(prisma, new Date('2026-01-05T09:00:00Z'));
    expect(first).toBeGreaterThanOrEqual(2); // assignee + issuer
    expect(second).toBe(0);
    expect(await prisma.notification.count({ where: { type: 'OVERDUE', entityId: assignmentIds[0] } })).toBe(2);
  });
});
