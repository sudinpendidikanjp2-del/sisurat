import type { DispositionCreateInput, ReviewDecisionInput, WorkUpdateInput } from '@sisurat/shared';
import type { Db, DbOrTx } from '../../db';
import type { Deps } from '../../lib/deps';
import type { ActionContext, AuthUser } from '../../lib/context';
import { audit } from '../../lib/audit';
import { can } from '../../lib/authz';
import { badRequest, forbidden, invalidState, notFound } from '../../lib/errors';
import { parseDateOnly } from '../../lib/dates';
import { notify } from '../../lib/notify';
import { recomputeLetterStatus } from '../../lib/letterStatus';
import { getSettings } from '../../lib/settings';
import { validateUpload } from '../../storage/fileValidation';
import { sha256 } from '../../lib/crypto';
import type { UploadedFile } from '../../lib/uploads';
import { findReadableLetter } from '../letters/service';

const DISPOSABLE = ['AWAITING_DISPOSITION', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_REVIEW', 'NEEDS_REVISION', 'COMPLETED'];
const WORKABLE = ['ASSIGNED', 'IN_PROGRESS', 'NEEDS_REVISION'];

async function assertAssignable(db: DbOrTx, ids: string[]) {
  const users = await db.user.findMany({
    where: {
      id: { in: ids },
      isActive: true,
      deletedAt: null,
      roles: { some: { role: { permissions: { some: { permission: { code: 'assignment.work' } } } } } },
    },
    select: { id: true, fullName: true },
  });
  if (users.length !== new Set(ids).size) throw badRequest('Pelaksana harus pegawai aktif yang dapat menerima penugasan');
  return users;
}

export async function createDisposition(db: Db, ctx: ActionContext, letterId: string, input: DispositionCreateInput) {
  return db.$transaction(async (tx) => {
    const letter = await findReadableLetter(tx, ctx.user, letterId);
    if (!DISPOSABLE.includes(letter.status)) {
      throw invalidState('Surat harus terdaftar dan diteruskan untuk disposisi terlebih dahulu');
    }
    const assignees = await assertAssignable(tx, input.assigneeIds);
    const dueDate = parseDateOnly(input.dueDate);
    if (dueDate && dueDate < parseDateOnly(new Date().toISOString().slice(0, 10))!) {
      throw badRequest('Tenggat tidak boleh di masa lalu');
    }
    const disposition = await tx.disposition.create({
      data: {
        incomingLetterId: letterId,
        issuerId: ctx.user.id,
        instruction: input.instruction,
        priority: input.priority,
        dueDate,
        assignments: {
          create: assignees.map((a) => ({ assigneeId: a.id, assignedById: ctx.user.id, dueDate })),
        },
      },
      include: { assignments: true },
    });
    if (letter.status === 'COMPLETED') {
      await tx.incomingLetter.update({ where: { id: letterId }, data: { status: 'ASSIGNED', completedAt: null } });
    } else if (letter.status === 'AWAITING_DISPOSITION') {
      await tx.incomingLetter.update({ where: { id: letterId }, data: { status: 'ASSIGNED', priority: input.priority } });
    }
    await recomputeLetterStatus(tx, letterId);
    await notify(
      tx,
      disposition.assignments.map((a) => ({
        userId: a.assigneeId,
        type: 'DISPOSITION_ASSIGNED' as const,
        title: 'Disposisi baru',
        message: `${letter.agendaNumber ?? ''} ${letter.subject ?? ''}: ${input.instruction.slice(0, 140)}`,
        entityType: 'Assignment',
        entityId: a.id,
        link: `/tugas/${a.id}`,
      })),
    );
    await audit(tx, ctx, {
      action: 'disposition.created',
      entityType: 'Disposition',
      entityId: disposition.id,
      after: {
        letterId,
        instruction: input.instruction,
        priority: input.priority,
        dueDate: input.dueDate,
        assignees: assignees.map((a) => a.fullName),
      },
    });
    return disposition;
  });
}

async function loadAssignment(db: DbOrTx, id: string) {
  const a = await db.assignment.findUnique({
    where: { id },
    include: { disposition: { include: { incomingLetter: true } }, assignee: { select: { id: true, fullName: true } } },
  });
  if (!a) throw notFound('Penugasan tidak ditemukan');
  return a;
}

type LoadedAssignment = Awaited<ReturnType<typeof loadAssignment>>;

/** Assignee, issuer, or anyone who can read the letter may view an assignment. */
export async function assertAssignmentReadable(db: DbOrTx, user: AuthUser, a: LoadedAssignment) {
  if (a.assigneeId === user.id || a.disposition.issuerId === user.id) return;
  await findReadableLetter(db, user, a.disposition.incomingLetterId);
}

/** Who may approve/request revision/cancel/reassign: the issuer, or another official with disposition.review. */
async function assertReviewer(db: DbOrTx, user: AuthUser, a: LoadedAssignment) {
  if (a.disposition.issuerId === user.id) return;
  if (!can(user, 'disposition.review')) throw forbidden('Hanya pemberi disposisi atau pejabat pemeriksa yang berwenang');
  await findReadableLetter(db, user, a.disposition.incomingLetterId);
}

async function refreshDisposition(tx: DbOrTx, dispositionId: string) {
  const d = await tx.disposition.findUniqueOrThrow({ where: { id: dispositionId }, include: { assignments: true } });
  if (d.status !== 'ACTIVE') return d.status;
  const live = d.assignments.filter((x) => x.status !== 'CANCELLED');
  if (live.length > 0 && live.every((x) => x.status === 'COMPLETED')) {
    await tx.disposition.update({ where: { id: dispositionId }, data: { status: 'COMPLETED', completedAt: new Date() } });
    return 'COMPLETED';
  }
  return d.status;
}

export async function startAssignment(db: Db, ctx: ActionContext, id: string) {
  return db.$transaction(async (tx) => {
    const a = await loadAssignment(tx, id);
    if (a.assigneeId !== ctx.user.id) throw forbidden('Hanya pelaksana yang dapat memulai tugas ini');
    if (a.status !== 'ASSIGNED') throw invalidState('Tugas sudah dimulai');
    await tx.assignment.update({ where: { id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
    await tx.workUpdate.create({ data: { assignmentId: id, authorId: ctx.user.id, type: 'STARTED', note: 'Mulai dikerjakan' } });
    await recomputeLetterStatus(tx, a.disposition.incomingLetterId);
    await audit(tx, ctx, { action: 'assignment.started', entityType: 'Assignment', entityId: id, before: { status: a.status }, after: { status: 'IN_PROGRESS' } });
  });
}

export async function addWorkUpdate(
  deps: Deps,
  ctx: ActionContext,
  id: string,
  input: WorkUpdateInput,
  files: UploadedFile[],
) {
  const { prisma, storage } = deps;
  const settings = await getSettings(prisma);
  const written: string[] = [];
  try {
    return await prisma.$transaction(async (tx) => {
      const a = await loadAssignment(tx, id);
      // Only the assignee updates progress; sending an update never completes the task by itself.
      if (a.assigneeId !== ctx.user.id) throw forbidden('Hanya pelaksana yang dapat memperbarui tugas ini');
      if (!WORKABLE.includes(a.status)) throw invalidState('Tugas tidak dalam status yang dapat diperbarui');

      const update = await tx.workUpdate.create({
        data: {
          assignmentId: id,
          authorId: ctx.user.id,
          type: input.submitForReview ? 'SUBMITTED' : 'PROGRESS',
          note: input.note,
          progressPercent: input.progressPercent ?? null,
        },
      });
      for (const f of files) {
        const v = await validateUpload(f.buffer, f.filename, {
          allowed: ['pdf', 'png', 'jpeg', 'docx'],
          maxBytes: settings.maxUploadMb * 1024 * 1024,
          maxPdfPages: settings.maxPdfPages,
        });
        const storageKey = await storage.put(f.buffer, v.extension);
        written.push(storageKey);
        await tx.document.create({
          data: {
            kind: 'EVIDENCE',
            storageKey,
            originalName: v.originalName,
            mimeType: v.mimeType,
            sizeBytes: f.buffer.length,
            pageCount: v.pageCount,
            checksumSha256: sha256(f.buffer),
            uploadedById: ctx.user.id,
            workUpdateId: update.id,
          },
        });
      }
      const nextStatus = input.submitForReview ? 'WAITING_REVIEW' : 'IN_PROGRESS';
      await tx.assignment.update({
        where: { id },
        data: {
          status: nextStatus,
          progressPercent: input.progressPercent ?? a.progressPercent,
          startedAt: a.startedAt ?? new Date(),
          ...(input.submitForReview && { submittedAt: new Date() }),
        },
      });
      await recomputeLetterStatus(tx, a.disposition.incomingLetterId);
      if (input.submitForReview) {
        await notify(tx, {
          userId: a.disposition.issuerId,
          type: 'ASSIGNMENT_SUBMITTED',
          title: 'Hasil tindak lanjut menunggu pemeriksaan',
          message: `${a.assignee.fullName} mengajukan hasil untuk "${a.disposition.incomingLetter.subject ?? ''}".`,
          entityType: 'Assignment',
          entityId: id,
          link: `/tugas/${id}`,
        });
      }
      await audit(tx, ctx, {
        action: input.submitForReview ? 'assignment.submitted' : 'assignment.progress',
        entityType: 'Assignment',
        entityId: id,
        before: { status: a.status, progressPercent: a.progressPercent },
        after: { status: nextStatus, progressPercent: input.progressPercent, evidence: files.length },
      });
      return update;
    });
  } catch (err) {
    await Promise.all(written.map((k) => storage.remove(k).catch(() => undefined)));
    throw err;
  }
}

export async function reviewAssignment(db: Db, ctx: ActionContext, id: string, input: ReviewDecisionInput) {
  return db.$transaction(async (tx) => {
    const a = await loadAssignment(tx, id);
    await assertReviewer(tx, ctx.user, a);
    if (a.status !== 'WAITING_REVIEW') throw invalidState('Tugas tidak sedang menunggu pemeriksaan');
    const approve = input.decision === 'APPROVE';
    if (!approve && !input.note) throw badRequest('Catatan revisi wajib diisi');
    await tx.assignment.update({
      where: { id },
      data: approve ? { status: 'COMPLETED', completedAt: new Date(), progressPercent: 100 } : { status: 'NEEDS_REVISION' },
    });
    await tx.workUpdate.create({
      data: {
        assignmentId: id,
        authorId: ctx.user.id,
        type: approve ? 'APPROVED' : 'REVISION_REQUESTED',
        note: input.note ?? (approve ? 'Disetujui' : null),
      },
    });
    const dispositionStatus = await refreshDisposition(tx, a.dispositionId);
    const letterStatus = await recomputeLetterStatus(tx, a.disposition.incomingLetterId);
    await notify(tx, {
      userId: a.assigneeId,
      type: approve ? 'ASSIGNMENT_APPROVED' : 'REVISION_REQUESTED',
      title: approve ? 'Tindak lanjut disetujui' : 'Tindak lanjut perlu revisi',
      message: `${a.disposition.incomingLetter.subject ?? ''}${input.note ? `: ${input.note.slice(0, 140)}` : ''}`,
      entityType: 'Assignment',
      entityId: id,
      link: `/tugas/${id}`,
    });
    await audit(tx, ctx, {
      action: approve ? 'assignment.approved' : 'assignment.revision_requested',
      entityType: 'Assignment',
      entityId: id,
      before: { status: a.status },
      after: { status: approve ? 'COMPLETED' : 'NEEDS_REVISION', note: input.note, dispositionStatus, letterStatus },
    });
  });
}

export async function cancelAssignment(db: Db, ctx: ActionContext, id: string, reason: string) {
  return db.$transaction(async (tx) => {
    const a = await loadAssignment(tx, id);
    await assertReviewer(tx, ctx.user, a);
    if (['COMPLETED', 'CANCELLED'].includes(a.status)) throw invalidState('Tugas sudah ditutup');
    await tx.assignment.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: new Date() } });
    await tx.workUpdate.create({ data: { assignmentId: id, authorId: ctx.user.id, type: 'CANCELLED', note: reason } });
    await refreshDisposition(tx, a.dispositionId);
    await recomputeLetterStatus(tx, a.disposition.incomingLetterId);
    await notify(tx, {
      userId: a.assigneeId,
      type: 'ASSIGNMENT_CANCELLED',
      title: 'Penugasan dibatalkan',
      message: `${a.disposition.incomingLetter.subject ?? ''}: ${reason.slice(0, 140)}`,
      entityType: 'Assignment',
      entityId: id,
      link: `/tugas/${id}`,
    });
    await audit(tx, ctx, { action: 'assignment.cancelled', entityType: 'Assignment', entityId: id, before: { status: a.status }, after: { status: 'CANCELLED', reason } });
  });
}

export async function reassignAssignment(db: Db, ctx: ActionContext, id: string, newAssigneeId: string, reason: string) {
  return db.$transaction(async (tx) => {
    const a = await loadAssignment(tx, id);
    await assertReviewer(tx, ctx.user, a);
    if (['COMPLETED', 'CANCELLED'].includes(a.status)) throw invalidState('Tugas sudah ditutup');
    if (newAssigneeId === a.assigneeId) throw badRequest('Pelaksana baru sama dengan pelaksana saat ini');
    const [newUser] = await assertAssignable(tx, [newAssigneeId]);
    await tx.assignment.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: `Dialihkan: ${reason}`, cancelledAt: new Date() } });
    await tx.workUpdate.create({
      data: { assignmentId: id, authorId: ctx.user.id, type: 'REASSIGNED', note: `Dialihkan ke ${newUser.fullName}: ${reason}` },
    });
    const created = await tx.assignment.create({
      data: {
        dispositionId: a.dispositionId,
        assigneeId: newUser.id,
        assignedById: ctx.user.id,
        dueDate: a.dueDate,
        reassignedFromId: a.id,
      },
    });
    await recomputeLetterStatus(tx, a.disposition.incomingLetterId);
    await notify(tx, [
      {
        userId: newUser.id,
        type: 'DISPOSITION_ASSIGNED',
        title: 'Penugasan dialihkan kepada Anda',
        message: `${a.disposition.incomingLetter.subject ?? ''}: ${a.disposition.instruction.slice(0, 140)}`,
        entityType: 'Assignment',
        entityId: created.id,
        link: `/tugas/${created.id}`,
      },
      {
        userId: a.assigneeId,
        type: 'ASSIGNMENT_CANCELLED',
        title: 'Penugasan dialihkan',
        message: `Tugas "${a.disposition.incomingLetter.subject ?? ''}" dialihkan ke ${newUser.fullName}.`,
        entityType: 'Assignment',
        entityId: id,
        link: `/tugas/${id}`,
      },
    ]);
    await audit(tx, ctx, {
      action: 'assignment.reassigned',
      entityType: 'Assignment',
      entityId: id,
      before: { assignee: a.assignee.fullName, status: a.status },
      after: { assignee: newUser.fullName, newAssignmentId: created.id, reason },
    });
    return created;
  });
}

export async function cancelDisposition(db: Db, ctx: ActionContext, id: string, reason: string) {
  return db.$transaction(async (tx) => {
    const d = await tx.disposition.findUnique({ where: { id } });
    if (!d) throw notFound('Disposisi tidak ditemukan');
    if (d.issuerId !== ctx.user.id && !can(ctx.user, 'disposition.review')) throw forbidden();
    await findReadableLetter(tx, ctx.user, d.incomingLetterId);
    if (d.status !== 'ACTIVE') throw invalidState('Disposisi sudah ditutup');
    await tx.disposition.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason } });
    const open = await tx.assignment.findMany({ where: { dispositionId: id, status: { notIn: ['COMPLETED', 'CANCELLED'] } } });
    for (const a of open) {
      await tx.assignment.update({ where: { id: a.id }, data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: new Date() } });
      await tx.workUpdate.create({ data: { assignmentId: a.id, authorId: ctx.user.id, type: 'CANCELLED', note: reason } });
    }
    await recomputeLetterStatus(tx, d.incomingLetterId);
    await notify(
      tx,
      open.map((a) => ({
        userId: a.assigneeId,
        type: 'ASSIGNMENT_CANCELLED' as const,
        title: 'Disposisi dibatalkan',
        message: reason.slice(0, 200),
        entityType: 'Assignment',
        entityId: a.id,
        link: `/tugas/${a.id}`,
      })),
    );
    await audit(tx, ctx, { action: 'disposition.cancelled', entityType: 'Disposition', entityId: id, after: { reason, cancelledAssignments: open.length } });
  });
}
