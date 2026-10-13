import type { OutgoingCreateInput, OutgoingType, PlaceholderDef } from '@sisurat/shared';
import type { Db, DbOrTx } from '../../db';
import type { Deps } from '../../lib/deps';
import type { ActionContext, AuthUser } from '../../lib/context';
import type { OutgoingLetter, Prisma } from '../../generated/prisma/client';
import { audit } from '../../lib/audit';
import { can, outgoingReadScope } from '../../lib/authz';
import { badRequest, forbidden, invalidState, notFound } from '../../lib/errors';
import { getSettings } from '../../lib/settings';
import { allocateNumber } from '../../lib/numbering';
import { notify } from '../../lib/notify';
import { sha256 } from '../../lib/crypto';
import { MIME_BY_KIND } from '../../storage/fileValidation';
import { PENDING_NUMBER_TEXT, missingRequired, renderDocx } from '../../docx/render';
import { findReadableLetter } from '../letters/service';

/** Classification code used in the {code} token of the outgoing number format. */
export const TYPE_CODES: Record<OutgoingType, string> = {
  UNDANGAN: 'UND',
  TUGAS: 'ST',
  KETERANGAN: 'SK',
  NOTA_DINAS: 'ND',
  PENGANTAR: 'SP',
};

const EDITABLE = ['DRAFT', 'NEEDS_REVISION'];

export async function findReadableOutgoing(db: DbOrTx, user: AuthUser, id: string) {
  const out = await db.outgoingLetter.findFirst({ where: { AND: [{ id }, outgoingReadScope(user)] } });
  if (out) return out;
  // Reviewers can open letters submitted for review.
  if (can(user, 'outgoing.review')) {
    const pending = await db.outgoingLetter.findFirst({
      where: { id, deletedAt: null, status: { in: ['WAITING_REVIEW', 'APPROVED'] }, confidentiality: { not: 'RAHASIA' } },
    });
    if (pending) return pending;
  }
  throw notFound('Surat keluar tidak ditemukan');
}

export function outgoingActions(user: AuthUser, o: OutgoingLetter) {
  const isOwner = o.createdById === user.id;
  return {
    edit: isOwner && EDITABLE.includes(o.status),
    submit: isOwner && EDITABLE.includes(o.status),
    review: can(user, 'outgoing.review') && o.status === 'WAITING_REVIEW' && !isOwner,
    finalize: can(user, 'outgoing.finalize') && o.status === 'APPROVED',
    cancel: (isOwner || can(user, 'outgoing.finalize')) && !['FINAL', 'CANCELLED'].includes(o.status),
  };
}

async function renderAndStore(
  tx: DbOrTx,
  deps: Pick<Deps, 'storage'>,
  params: { outgoing: OutgoingLetter; userId: string; number: string | null; written: string[] },
) {
  const template = await tx.documentTemplate.findUniqueOrThrow({ where: { id: params.outgoing.templateId }, include: { file: true } });
  if (!template.file) throw invalidState('Berkas templat tidak ditemukan');
  const settings = await getSettings(tx);
  const templateBuf = await deps.storage.read(template.file.storageKey);
  const data = {
    ...(params.outgoing.data as Record<string, string>),
    nomor: params.number ?? PENDING_NUMBER_TEXT,
    nama_instansi: settings.organizationName,
  };
  const buffer = renderDocx(templateBuf, data);
  const storageKey = await deps.storage.put(buffer, 'docx');
  params.written.push(storageKey);
  const last = await tx.document.findFirst({
    where: { outgoingLetterId: params.outgoing.id, kind: 'GENERATED' },
    orderBy: { version: 'desc' },
  });
  const safeSubject = params.outgoing.subject.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60).trim() || 'surat';
  return tx.document.create({
    data: {
      kind: 'GENERATED',
      storageKey,
      originalName: `${params.number ? params.number.replace(/[/\\]/g, '-') : 'DRAFT'} - ${safeSubject}.docx`,
      mimeType: MIME_BY_KIND.docx,
      sizeBytes: buffer.length,
      checksumSha256: sha256(buffer),
      uploadedById: params.userId,
      outgoingLetterId: params.outgoing.id,
      version: (last?.version ?? 0) + 1,
    },
  });
}

async function validateLinks(tx: DbOrTx, user: AuthUser, input: { incomingLetterIds?: string[]; dispositionId?: string | null }) {
  for (const id of input.incomingLetterIds ?? []) await findReadableLetter(tx, user, id);
  if (input.dispositionId) {
    const d = await tx.disposition.findUnique({ where: { id: input.dispositionId }, include: { assignments: true } });
    if (!d) throw badRequest('Disposisi tidak ditemukan');
    const involved = d.issuerId === user.id || d.assignments.some((a) => a.assigneeId === user.id);
    if (!involved) await findReadableLetter(tx, user, d.incomingLetterId);
    return d;
  }
  return null;
}

function cleanData(defs: PlaceholderDef[], data: Record<string, string>) {
  // Only keys defined by the template are kept, so arbitrary tags cannot be injected.
  const out: Record<string, string> = {};
  for (const d of defs) out[d.key] = (data[d.key] ?? '').trim();
  return out;
}

export async function createOutgoing(deps: Deps, ctx: ActionContext, input: OutgoingCreateInput) {
  const { prisma, storage } = deps;
  const written: string[] = [];
  try {
    return await prisma.$transaction(async (tx) => {
      const template = await tx.documentTemplate.findUnique({ where: { id: input.templateId } });
      if (!template || !template.isActive) throw badRequest('Templat tidak aktif atau tidak ditemukan');
      const defs = template.placeholders as PlaceholderDef[];
      const missing = missingRequired(defs, input.data);
      if (missing.length) throw badRequest(`Field wajib belum diisi: ${missing.join(', ')}`);
      const disposition = await validateLinks(tx, ctx.user, input);
      const linkIds = new Set(input.incomingLetterIds);
      if (disposition) linkIds.add(disposition.incomingLetterId);

      const outgoing = await tx.outgoingLetter.create({
        data: {
          type: template.type,
          templateId: template.id,
          templateVersion: template.version,
          subject: input.subject,
          recipient: input.recipient,
          data: cleanData(defs, input.data),
          confidentiality: input.confidentiality,
          dispositionId: disposition?.id ?? null,
          createdById: ctx.user.id,
          links: { create: [...linkIds].map((incomingLetterId) => ({ incomingLetterId })) },
        },
      });
      await renderAndStore(tx, deps, { outgoing, userId: ctx.user.id, number: null, written });
      await audit(tx, ctx, {
        action: 'outgoing.created',
        entityType: 'OutgoingLetter',
        entityId: outgoing.id,
        after: {
          type: template.type,
          templateVersion: template.version,
          subject: input.subject,
          linkedIncoming: [...linkIds],
          dispositionId: disposition?.id,
        },
      });
      return outgoing;
    });
  } catch (err) {
    await Promise.all(written.map((k) => storage.remove(k).catch(() => undefined)));
    throw err;
  }
}

export async function updateOutgoing(
  deps: Deps,
  ctx: ActionContext,
  id: string,
  input: Partial<Omit<OutgoingCreateInput, 'templateId'>>,
) {
  const { prisma, storage } = deps;
  const written: string[] = [];
  try {
    return await prisma.$transaction(async (tx) => {
      const out = await findReadableOutgoing(tx, ctx.user, id);
      if (out.createdById !== ctx.user.id) throw forbidden('Hanya penyusun yang dapat mengubah draft');
      if (!EDITABLE.includes(out.status)) throw invalidState('Surat keluar tidak dapat diubah pada status ini');
      const template = await tx.documentTemplate.findUniqueOrThrow({ where: { id: out.templateId } });
      const defs = template.placeholders as PlaceholderDef[];
      const data = input.data ? cleanData(defs, input.data) : (out.data as Record<string, string>);
      const missing = missingRequired(defs, data);
      if (missing.length) throw badRequest(`Field wajib belum diisi: ${missing.join(', ')}`);
      await validateLinks(tx, ctx.user, input);
      if (input.incomingLetterIds) {
        await tx.outgoingLetterLink.deleteMany({ where: { outgoingLetterId: id } });
        await tx.outgoingLetterLink.createMany({
          data: input.incomingLetterIds.map((incomingLetterId) => ({ outgoingLetterId: id, incomingLetterId })),
        });
      }
      const updated = await tx.outgoingLetter.update({
        where: { id },
        data: {
          subject: input.subject,
          recipient: input.recipient,
          confidentiality: input.confidentiality,
          data,
          ...(input.dispositionId !== undefined && { dispositionId: input.dispositionId }),
        },
      });
      // A new document version is created; earlier versions are kept for the audit trail.
      await renderAndStore(tx, deps, { outgoing: updated, userId: ctx.user.id, number: null, written });
      await audit(tx, ctx, {
        action: 'outgoing.updated',
        entityType: 'OutgoingLetter',
        entityId: id,
        before: { subject: out.subject, recipient: out.recipient, data: out.data as Prisma.JsonObject },
        after: { subject: updated.subject, recipient: updated.recipient, data },
      });
      return updated;
    });
  } catch (err) {
    await Promise.all(written.map((k) => storage.remove(k).catch(() => undefined)));
    throw err;
  }
}

export async function submitOutgoing(db: Db, ctx: ActionContext, id: string) {
  return db.$transaction(async (tx) => {
    const out = await findReadableOutgoing(tx, ctx.user, id);
    if (out.createdById !== ctx.user.id) throw forbidden('Hanya penyusun yang dapat mengajukan');
    if (!EDITABLE.includes(out.status)) throw invalidState('Surat keluar sudah diajukan');
    await tx.outgoingLetter.update({ where: { id }, data: { status: 'WAITING_REVIEW' } });
    // Reviewer: the disposition issuer when linked, otherwise every official with outgoing.review.
    let reviewerIds: string[] = [];
    if (out.dispositionId) {
      const d = await tx.disposition.findUnique({ where: { id: out.dispositionId } });
      if (d) reviewerIds = [d.issuerId];
    }
    if (reviewerIds.length === 0) {
      const reviewers = await tx.user.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          id: { not: ctx.user.id },
          roles: { some: { role: { permissions: { some: { permission: { code: 'outgoing.review' } } } } } },
        },
        select: { id: true },
      });
      reviewerIds = reviewers.map((r) => r.id);
    }
    await notify(
      tx,
      reviewerIds.filter((r) => r !== ctx.user.id).map((userId) => ({
        userId,
        type: 'OUTGOING_REVIEW_REQUESTED' as const,
        title: 'Surat keluar menunggu pemeriksaan',
        message: `${out.subject} (kepada ${out.recipient})`,
        entityType: 'OutgoingLetter',
        entityId: id,
        link: `/surat-keluar/${id}`,
      })),
    );
    await audit(tx, ctx, { action: 'outgoing.submitted', entityType: 'OutgoingLetter', entityId: id, before: { status: out.status }, after: { status: 'WAITING_REVIEW' } });
  });
}

export async function reviewOutgoing(db: Db, ctx: ActionContext, id: string, decision: 'APPROVE' | 'REQUEST_REVISION', note?: string | null) {
  return db.$transaction(async (tx) => {
    const out = await findReadableOutgoing(tx, ctx.user, id);
    if (!can(ctx.user, 'outgoing.review')) throw forbidden();
    if (out.createdById === ctx.user.id) throw forbidden('Penyusun tidak dapat menyetujui suratnya sendiri');
    if (out.status !== 'WAITING_REVIEW') throw invalidState('Surat keluar tidak sedang menunggu pemeriksaan');
    if (decision === 'REQUEST_REVISION' && !note) throw badRequest('Catatan revisi wajib diisi');
    const status = decision === 'APPROVE' ? 'APPROVED' : 'NEEDS_REVISION';
    await tx.outgoingLetter.update({
      where: { id },
      data: { status, reviewedById: ctx.user.id, reviewedAt: new Date(), reviewNote: note ?? null },
    });
    await notify(tx, {
      userId: out.createdById,
      type: 'OUTGOING_REVIEWED',
      title: decision === 'APPROVE' ? 'Surat keluar disetujui' : 'Surat keluar perlu revisi',
      message: `${out.subject}${note ? `: ${note.slice(0, 140)}` : ''}`,
      entityType: 'OutgoingLetter',
      entityId: id,
      link: `/surat-keluar/${id}`,
    });
    await audit(tx, ctx, {
      action: decision === 'APPROVE' ? 'outgoing.approved' : 'outgoing.revision_requested',
      entityType: 'OutgoingLetter',
      entityId: id,
      before: { status: out.status },
      after: { status, note },
    });
  });
}

/** Assigns the official number and renders the final DOCX. Legal validity still follows the office process. */
export async function finalizeOutgoing(deps: Deps, ctx: ActionContext, id: string) {
  const { prisma, storage } = deps;
  const written: string[] = [];
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "OutgoingLetter" WHERE id = ${id} FOR UPDATE`;
      const out = await findReadableOutgoing(tx, ctx.user, id);
      if (!can(ctx.user, 'outgoing.finalize')) throw forbidden();
      if (out.status !== 'APPROVED') throw invalidState('Surat keluar harus disetujui sebelum difinalkan');
      const settings = await getSettings(tx);
      const n = await allocateNumber(tx, {
        key: `outgoing`,
        format: settings.outgoingNumberFormat,
        code: TYPE_CODES[out.type],
      });
      const updated = await tx.outgoingLetter.update({
        where: { id },
        data: { status: 'FINAL', number: n.number, numberYear: n.year, numberSeq: n.seq, finalizedById: ctx.user.id, finalizedAt: new Date() },
      });
      const doc = await renderAndStore(tx, deps, { outgoing: updated, userId: ctx.user.id, number: n.number, written });
      await audit(tx, ctx, {
        action: 'outgoing.finalized',
        entityType: 'OutgoingLetter',
        entityId: id,
        before: { status: out.status },
        after: { status: 'FINAL', number: n.number, documentId: doc.id, templateVersion: out.templateVersion },
      });
      return updated;
    });
  } catch (err) {
    await Promise.all(written.map((k) => storage.remove(k).catch(() => undefined)));
    throw err;
  }
}

export async function cancelOutgoing(db: Db, ctx: ActionContext, id: string, reason: string) {
  return db.$transaction(async (tx) => {
    const out = await findReadableOutgoing(tx, ctx.user, id);
    if (out.createdById !== ctx.user.id && !can(ctx.user, 'outgoing.finalize')) throw forbidden();
    if (['FINAL', 'CANCELLED'].includes(out.status)) throw invalidState('Surat keluar sudah final atau dibatalkan');
    await tx.outgoingLetter.update({ where: { id }, data: { status: 'CANCELLED', reviewNote: reason } });
    await audit(tx, ctx, { action: 'outgoing.cancelled', entityType: 'OutgoingLetter', entityId: id, before: { status: out.status }, after: { status: 'CANCELLED', reason } });
  });
}
