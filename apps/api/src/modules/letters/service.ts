import type { LetterMetadataInput, LetterVerifyInput, NormalizedFields } from '@sisurat/shared';
import type { Db, DbOrTx } from '../../db';
import type { Deps } from '../../lib/deps';
import type { ActionContext, AuthUser } from '../../lib/context';
import { Prisma, type IncomingLetter } from '../../generated/prisma/client';
import { audit, diff, normalizeForCompare } from '../../lib/audit';
import { can, letterReadScope } from '../../lib/authz';
import { badRequest, conflict, forbidden, invalidState, notFound } from '../../lib/errors';
import { parseDateOnly, toDateOnly } from '../../lib/dates';
import { getSettings } from '../../lib/settings';
import { allocateNumber } from '../../lib/numbering';
import { notify } from '../../lib/notify';
import { validateUpload } from '../../storage/fileValidation';
import { sha256 } from '../../lib/crypto';
import type { UploadedFile } from '../../lib/uploads';
import { enqueueExtraction } from '../../jobs/extraction';

/** Letter column ↔ extraction field mapping. */
export const FIELD_MAP = {
  letterType: 'document_type',
  letterNumber: 'letter_number',
  letterDate: 'letter_date',
  senderName: 'sender_name',
  recipientName: 'recipient_name',
  subject: 'subject',
  attachmentText: 'attachment_text',
  eventDate: 'event_date',
  eventLocation: 'event_location',
  summary: 'summary',
  category: 'suggested_category',
} as const satisfies Record<string, keyof NormalizedFields>;

const DATE_FIELDS = new Set(['letterDate', 'receivedDate', 'eventDate']);
const FINAL_STATUSES = ['ARCHIVED', 'CANCELLED'];

/** Converts validated metadata input into Prisma column values (dates → Date). */
export function toLetterData(input: Partial<LetterMetadataInput>) {
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    data[k] = DATE_FIELDS.has(k) ? parseDateOnly(v as string | null) : v;
  }
  return data as Prisma.IncomingLetterUncheckedUpdateInput;
}

export function letterSnapshot(l: IncomingLetter) {
  return {
    letterType: l.letterType,
    letterNumber: l.letterNumber,
    letterDate: toDateOnly(l.letterDate),
    receivedDate: toDateOnly(l.receivedDate),
    senderName: l.senderName,
    recipientName: l.recipientName,
    subject: l.subject,
    attachmentText: l.attachmentText,
    eventDate: toDateOnly(l.eventDate),
    eventLocation: l.eventLocation,
    summary: l.summary,
    category: l.category,
    priority: l.priority,
    confidentiality: l.confidentiality,
    notes: l.notes,
  };
}

export async function findReadableLetter(db: DbOrTx, user: AuthUser, id: string) {
  const letter = await db.incomingLetter.findFirst({ where: { AND: [{ id }, letterReadScope(user)] } });
  // 404 rather than 403 so the existence of letters outside the user's scope is not revealed.
  if (!letter) throw notFound('Surat tidak ditemukan');
  return letter;
}

/** Actions the current user may take — the UI uses this, the API re-checks every one. */
export function allowedActions(user: AuthUser, l: IncomingLetter, extra: { activeDispositions: number }) {
  const open = !FINAL_STATUSES.includes(l.status) && !l.deletedAt;
  return {
    edit: open && can(user, 'letter.update'),
    extract: l.status === 'DRAFT' && l.processingStatus !== 'VERIFIED' && can(user, 'extraction.run'),
    verify: l.status === 'DRAFT' && can(user, 'letter.verify'),
    addDocuments: open && can(user, 'letter.create'),
    forward: ['REGISTERED', 'AWAITING_DISPOSITION'].includes(l.status) && can(user, 'letter.forward'),
    dispose:
      ['AWAITING_DISPOSITION', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_REVIEW', 'NEEDS_REVISION', 'COMPLETED'].includes(l.status) &&
      can(user, 'disposition.create'),
    archive: ['REGISTERED', 'AWAITING_DISPOSITION', 'COMPLETED'].includes(l.status) && can(user, 'letter.archive'),
    cancel: open && can(user, 'letter.delete'),
    createReply: l.status !== 'DRAFT' && !l.deletedAt && can(user, 'outgoing.create'),
    activeDispositions: extra.activeDispositions,
  };
}

async function storeFiles(
  tx: DbOrTx,
  deps: Pick<Deps, 'storage'>,
  files: UploadedFile[],
  opts: { letterId: string; userId: string; maxBytes: number; maxPdfPages: number; firstIsSource: boolean },
  written: string[],
) {
  const docs = [];
  for (const [i, f] of files.entries()) {
    const v = await validateUpload(f.buffer, f.filename, {
      allowed: ['pdf', 'png', 'jpeg'],
      maxBytes: opts.maxBytes,
      maxPdfPages: opts.maxPdfPages,
    });
    const storageKey = await deps.storage.put(f.buffer, v.extension);
    written.push(storageKey);
    docs.push(
      await tx.document.create({
        data: {
          kind: opts.firstIsSource && i === 0 ? 'SOURCE' : 'ATTACHMENT',
          storageKey,
          originalName: v.originalName,
          mimeType: v.mimeType,
          sizeBytes: f.buffer.length,
          pageCount: v.pageCount,
          checksumSha256: sha256(f.buffer),
          uploadedById: opts.userId,
          incomingLetterId: opts.letterId,
        },
      }),
    );
  }
  return docs;
}

export async function createLetter(
  deps: Deps,
  ctx: ActionContext,
  input: LetterMetadataInput & { autoExtract?: boolean },
  files: UploadedFile[],
) {
  const { prisma, storage } = deps;
  const settings = await getSettings(prisma);
  if (files.length === 0 && !input.subject) {
    throw badRequest('Unggah dokumen surat atau isi minimal perihal untuk pencatatan manual');
  }
  if (files.length > settings.maxFilesPerLetter) {
    throw badRequest(`Maksimal ${settings.maxFilesPerLetter} berkas per surat`);
  }
  const { autoExtract, ...meta } = input;
  const written: string[] = [];
  try {
    const { letter, docs } = await prisma.$transaction(async (tx) => {
      const letter = await tx.incomingLetter.create({
        data: {
          ...(toLetterData(meta) as Prisma.IncomingLetterUncheckedCreateInput),
          receivedDate: parseDateOnly(meta.receivedDate) ?? new Date(),
          createdById: ctx.user.id,
          status: 'DRAFT',
          processingStatus: 'UPLOADED',
        },
      });
      const docs = await storeFiles(tx, deps, files, {
        letterId: letter.id,
        userId: ctx.user.id,
        maxBytes: settings.maxUploadMb * 1024 * 1024,
        maxPdfPages: settings.maxPdfPages,
        firstIsSource: true,
      }, written);
      await audit(tx, ctx, {
        action: 'letter.created',
        entityType: 'IncomingLetter',
        entityId: letter.id,
        after: {
          files: docs.map((d) => ({ name: d.originalName, sha256: d.checksumSha256, pages: d.pageCount })),
          confidentiality: letter.confidentiality,
          manual: files.length === 0,
        },
      });
      return { letter, docs };
    });

    let job = null;
    const shouldExtract = (autoExtract ?? settings.autoExtractOnUpload) && docs.length > 0 && can(ctx.user, 'extraction.run');
    if (shouldExtract) {
      ({ job } = await enqueueExtraction(prisma, { documentId: docs[0].id, requestedById: ctx.user.id }));
      deps.onJobEnqueued?.();
    }
    return { letter, documents: docs, job };
  } catch (err) {
    // Roll back files written for a transaction that did not commit.
    await Promise.all(written.map((k) => storage.remove(k).catch(() => undefined)));
    throw err;
  }
}

export async function addDocuments(deps: Deps, ctx: ActionContext, letterId: string, files: UploadedFile[]) {
  const { prisma, storage } = deps;
  const letter = await findReadableLetter(prisma, ctx.user, letterId);
  if (FINAL_STATUSES.includes(letter.status)) throw invalidState('Surat sudah ditutup');
  if (files.length === 0) throw badRequest('Tidak ada berkas yang diunggah');
  const settings = await getSettings(prisma);
  const existing = await prisma.document.count({ where: { incomingLetterId: letterId, deletedAt: null } });
  if (existing + files.length > settings.maxFilesPerLetter) {
    throw badRequest(`Maksimal ${settings.maxFilesPerLetter} berkas per surat`);
  }
  const hasSource = await prisma.document.count({ where: { incomingLetterId: letterId, kind: 'SOURCE' } });
  const written: string[] = [];
  try {
    return await prisma.$transaction(async (tx) => {
      const docs = await storeFiles(tx, deps, files, {
        letterId,
        userId: ctx.user.id,
        maxBytes: settings.maxUploadMb * 1024 * 1024,
        maxPdfPages: settings.maxPdfPages,
        firstIsSource: hasSource === 0,
      }, written);
      await audit(tx, ctx, {
        action: 'letter.documents_added',
        entityType: 'IncomingLetter',
        entityId: letterId,
        after: { files: docs.map((d) => d.originalName) },
      });
      return docs;
    });
  } catch (err) {
    await Promise.all(written.map((k) => storage.remove(k).catch(() => undefined)));
    throw err;
  }
}

export async function updateLetter(db: Db, ctx: ActionContext, id: string, input: Partial<LetterMetadataInput>) {
  return db.$transaction(async (tx) => {
    const letter = await findReadableLetter(tx, ctx.user, id);
    if (FINAL_STATUSES.includes(letter.status)) throw invalidState('Surat yang sudah diarsipkan/dibatalkan tidak dapat diubah');
    const before = letterSnapshot(letter);
    const { before: b, after: a, changed } = diff(before, input as Record<string, unknown>);
    if (changed.length === 0) return letter;
    if (letter.verifiedAt) {
      for (const key of ['letterNumber', 'letterDate', 'receivedDate', 'senderName', 'recipientName', 'subject'] as const) {
        if (key in a && !a[key]) throw badRequest('Field utama surat terdaftar tidak boleh dikosongkan');
      }
    }
    const updated = await tx.incomingLetter.update({ where: { id }, data: toLetterData(input) });
    if (letter.verifiedAt) {
      // Post-verification edits are tracked field by field (PRD AT-06).
      await tx.metadataCorrection.createMany({
        data: changed.map((field) => ({
          incomingLetterId: id,
          field,
          previousValue: normalizeForCompare(b[field]),
          newValue: normalizeForCompare(a[field]),
          source: 'POST_VERIFICATION_EDIT' as const,
          correctedById: ctx.user.id,
        })),
      });
    }
    await audit(tx, ctx, { action: 'letter.updated', entityType: 'IncomingLetter', entityId: id, before: b, after: a });
    return updated;
  });
}

export async function verifyLetter(db: Db, ctx: ActionContext, id: string, input: LetterVerifyInput) {
  return db.$transaction(async (tx) => {
    // Row lock: two officers cannot register the same letter twice.
    await tx.$queryRaw`SELECT id FROM "IncomingLetter" WHERE id = ${id} FOR UPDATE`;
    const letter = await findReadableLetter(tx, ctx.user, id);
    if (letter.status !== 'DRAFT' || letter.verifiedAt) throw invalidState('Surat sudah diverifikasi dan terdaftar');

    const duplicates = await tx.incomingLetter.findMany({
      where: {
        id: { not: id },
        deletedAt: null,
        status: { not: 'CANCELLED' },
        letterNumber: { equals: input.letterNumber, mode: 'insensitive' },
        senderName: { equals: input.senderName, mode: 'insensitive' },
      },
      select: { id: true, agendaNumber: true, subject: true, receivedDate: true },
    });
    if (duplicates.length && !input.confirmNotDuplicate) {
      throw conflict('Surat dengan nomor dan pengirim yang sama sudah tercatat', { duplicates });
    }

    let result: { id: string; normalizedFields: unknown } | null = null;
    if (input.extractionResultId) {
      result = await tx.extractionResult.findFirst({
        where: { id: input.extractionResultId, job: { incomingLetterId: id } },
        select: { id: true, normalizedFields: true },
      });
      if (!result) throw badRequest('Hasil ekstraksi tidak sesuai dengan surat ini');
    }

    const { extractionResultId: _r, confirmNotDuplicate: _c, ...meta } = input;
    const settings = await getSettings(tx);
    const receivedDate = parseDateOnly(meta.receivedDate)!;
    const agenda = await allocateNumber(tx, {
      key: 'agenda',
      format: settings.agendaNumberFormat,
      date: receivedDate,
    });
    const now = new Date();
    const updated = await tx.incomingLetter.update({
      where: { id },
      data: {
        ...toLetterData(meta),
        processingStatus: 'VERIFIED',
        status: 'REGISTERED',
        verifiedById: ctx.user.id,
        verifiedAt: now,
        registeredAt: now,
        agendaNumber: agenda.number,
        agendaYear: agenda.year,
        agendaSeq: agenda.seq,
      },
    });

    let corrections = 0;
    if (result) {
      const ai = result.normalizedFields as NormalizedFields;
      const rows = [];
      for (const [col, field] of Object.entries(FIELD_MAP)) {
        const aiValue = normalizeForCompare(ai[field]);
        const finalValue = normalizeForCompare((meta as Record<string, unknown>)[col]);
        if (aiValue !== finalValue) {
          rows.push({
            incomingLetterId: id,
            extractionResultId: result.id,
            field: col,
            previousValue: aiValue,
            newValue: finalValue,
            source: 'VERIFICATION' as const,
            correctedById: ctx.user.id,
          });
        }
      }
      if (rows.length) await tx.metadataCorrection.createMany({ data: rows });
      corrections = rows.length;
      await tx.extractionResult.update({ where: { id: result.id }, data: { reviewedById: ctx.user.id, reviewedAt: now } });
    }

    await audit(tx, ctx, {
      action: 'letter.verified',
      entityType: 'IncomingLetter',
      entityId: id,
      before: letterSnapshot(letter),
      after: { ...letterSnapshot(updated), agendaNumber: agenda.number, corrections, fromExtraction: Boolean(result) },
    });
    return updated;
  });
}

export async function forwardLetter(db: Db, ctx: ActionContext, id: string, input: { leaderId: string; note?: string | null }) {
  return db.$transaction(async (tx) => {
    const letter = await findReadableLetter(tx, ctx.user, id);
    if (!['REGISTERED', 'AWAITING_DISPOSITION'].includes(letter.status)) {
      throw invalidState('Hanya surat terdaftar yang dapat diteruskan untuk disposisi');
    }
    const leader = await tx.user.findFirst({
      where: {
        id: input.leaderId,
        isActive: true,
        deletedAt: null,
        roles: { some: { role: { permissions: { some: { permission: { code: 'disposition.create' } } } } } },
      },
    });
    if (!leader) throw badRequest('Penerima harus pejabat yang berwenang memberi disposisi');
    const updated = await tx.incomingLetter.update({
      where: { id },
      data: { status: 'AWAITING_DISPOSITION', forwardedToId: leader.id, forwardedAt: new Date() },
    });
    await notify(tx, {
      userId: leader.id,
      type: 'LETTER_FORWARDED',
      title: 'Surat menunggu disposisi',
      message: `${letter.agendaNumber}: ${letter.subject ?? '(tanpa perihal)'}${input.note ? ` — ${input.note}` : ''}`,
      entityType: 'IncomingLetter',
      entityId: id,
      link: `/surat-masuk/${id}`,
    });
    await audit(tx, ctx, {
      action: 'letter.forwarded',
      entityType: 'IncomingLetter',
      entityId: id,
      before: { status: letter.status, forwardedToId: letter.forwardedToId },
      after: { status: updated.status, forwardedTo: leader.fullName, note: input.note },
    });
    return updated;
  });
}

export async function archiveLetter(db: Db, ctx: ActionContext, id: string, note?: string | null) {
  return db.$transaction(async (tx) => {
    const letter = await findReadableLetter(tx, ctx.user, id);
    if (!['REGISTERED', 'AWAITING_DISPOSITION', 'COMPLETED'].includes(letter.status)) {
      throw invalidState('Surat hanya dapat diarsipkan setelah terdaftar dan tidak ada tindak lanjut yang berjalan');
    }
    const active = await tx.disposition.count({ where: { incomingLetterId: id, status: 'ACTIVE' } });
    if (active > 0 && letter.status !== 'COMPLETED') throw invalidState('Masih ada disposisi aktif');
    const updated = await tx.incomingLetter.update({ where: { id }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
    await audit(tx, ctx, {
      action: 'letter.archived',
      entityType: 'IncomingLetter',
      entityId: id,
      before: { status: letter.status },
      after: { status: 'ARCHIVED', note },
    });
    return updated;
  });
}

/** Cancels a letter with a reason. Draft letters are soft-deleted; registered ones keep their agenda number. */
export async function cancelLetter(db: Db, ctx: ActionContext, id: string, reason: string) {
  return db.$transaction(async (tx) => {
    const letter = await findReadableLetter(tx, ctx.user, id);
    if (FINAL_STATUSES.includes(letter.status)) throw invalidState('Surat sudah ditutup');
    if (!can(ctx.user, 'letter.delete')) throw forbidden();
    const isDraft = letter.status === 'DRAFT';
    await tx.extractionJob.updateMany({
      where: { incomingLetterId: id, status: 'QUEUED' },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });
    await tx.disposition.updateMany({
      where: { incomingLetterId: id, status: 'ACTIVE' },
      data: { status: 'CANCELLED', cancelReason: reason },
    });
    await tx.assignment.updateMany({
      where: { disposition: { incomingLetterId: id }, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: new Date() },
    });
    const updated = await tx.incomingLetter.update({
      where: { id },
      data: { status: 'CANCELLED', ...(isDraft && { deletedAt: new Date() }), notes: letter.notes ? `${letter.notes}\n[Dibatalkan] ${reason}` : `[Dibatalkan] ${reason}` },
    });
    await audit(tx, ctx, {
      action: isDraft ? 'letter.deleted' : 'letter.cancelled',
      entityType: 'IncomingLetter',
      entityId: id,
      before: { status: letter.status },
      after: { status: 'CANCELLED', reason },
    });
    return updated;
  });
}
