import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  OUTGOING_TYPES,
  outgoingCreateSchema,
  outgoingListQuerySchema,
  outgoingUpdateSchema,
  reasonSchema,
  reviewDecisionSchema,
  templateUpdateSchema,
  type PlaceholderDef,
} from '@sisurat/shared';
import type { Deps } from '../../lib/deps';
import { requireAuth, requirePermission } from '../../plugins/auth';
import { ctxOf, pageMeta, parse, requireUser } from '../../lib/http';
import { outgoingReadScope } from '../../lib/authz';
import { readMultipart } from '../../lib/uploads';
import { badRequest, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { parseDateOnly } from '../../lib/dates';
import { sha256 } from '../../lib/crypto';
import { validateUpload } from '../../storage/fileValidation';
import { SYSTEM_PLACEHOLDERS, defaultPlaceholderDefs, detectPlaceholders } from '../../docx/render';
import type { Prisma } from '../../generated/prisma/client';
import { documentSelect } from '../letters/routes';
import {
  cancelOutgoing,
  createOutgoing,
  finalizeOutgoing,
  findReadableOutgoing,
  outgoingActions,
  reviewOutgoing,
  submitOutgoing,
  updateOutgoing,
} from './service';

const userRef = { select: { id: true, fullName: true, position: true } } as const;

export default async function outgoingRoutes(app: FastifyInstance, deps: Deps) {
  const { prisma, storage } = deps;

  // ---------------- templates
  const templateRead = requirePermission('template.manage', 'outgoing.create');

  app.get('/api/templates', { preHandler: templateRead }, async (req) => {
    const q = parse(z.object({ type: z.enum(OUTGOING_TYPES).optional(), active: z.enum(['true', 'false']).optional() }), req.query);
    const items = await prisma.documentTemplate.findMany({
      where: { ...(q.type && { type: q.type }), ...(q.active && { isActive: q.active === 'true' }) },
      orderBy: [{ type: 'asc' }, { version: 'desc' }],
      include: { createdBy: userRef, file: { select: documentSelect }, _count: { select: { outgoingLetters: true } } },
    });
    return { items };
  });

  app.get<{ Params: { id: string } }>('/api/templates/:id', { preHandler: templateRead }, async (req) => {
    const t = await prisma.documentTemplate.findUnique({
      where: { id: req.params.id },
      include: { createdBy: userRef, file: { select: documentSelect } },
    });
    if (!t) throw notFound('Templat tidak ditemukan');
    return t;
  });

  app.post('/api/templates', { preHandler: requirePermission('template.manage') }, async (req, reply) => {
    const ctx = ctxOf(req);
    const { fields, files } = await readMultipart(req, { maxFiles: 1, maxBytes: 10 * 1024 * 1024 });
    const meta = parse(
      z.object({
        type: z.enum(OUTGOING_TYPES),
        name: z.string().trim().min(3).max(150),
        approvedByName: z.string().trim().max(150).optional(),
        activeFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
      }),
      fields,
    );
    const file = files[0];
    if (!file) throw badRequest('Berkas templat DOCX wajib diunggah');
    const v = await validateUpload(file.buffer, file.filename, { allowed: ['docx'], maxBytes: 10 * 1024 * 1024 });
    const keys = detectPlaceholders(file.buffer);
    if (keys.length === 0) throw badRequest('Templat tidak memiliki placeholder {nama_field}');
    const storageKey = await storage.put(file.buffer, v.extension);
    try {
      const t = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'template:' + meta.type}))`;
        const last = await tx.documentTemplate.findFirst({ where: { type: meta.type }, orderBy: { version: 'desc' } });
        const t = await tx.documentTemplate.create({
          data: {
            type: meta.type,
            name: meta.name,
            version: (last?.version ?? 0) + 1,
            placeholders: defaultPlaceholderDefs(keys),
            approvedByName: meta.approvedByName || null,
            activeFrom: parseDateOnly(meta.activeFrom || null),
            createdById: ctx.user.id,
            isActive: true,
          },
        });
        await tx.document.create({
          data: {
            kind: 'TEMPLATE',
            storageKey,
            originalName: v.originalName,
            mimeType: v.mimeType,
            sizeBytes: file.buffer.length,
            checksumSha256: sha256(file.buffer),
            uploadedById: ctx.user.id,
            templateId: t.id,
          },
        });
        await audit(tx, ctx, {
          action: 'template.created',
          entityType: 'DocumentTemplate',
          entityId: t.id,
          after: { type: t.type, version: t.version, placeholders: keys },
        });
        return t;
      });
      return reply.code(201).send(t);
    } catch (err) {
      await storage.remove(storageKey).catch(() => undefined);
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>('/api/templates/:id', { preHandler: requirePermission('template.manage') }, async (req) => {
    const body = parse(templateUpdateSchema, req.body);
    const t = await prisma.documentTemplate.findUnique({ where: { id: req.params.id } });
    if (!t) throw notFound('Templat tidak ditemukan');
    if (body.placeholders) {
      const current = new Set((t.placeholders as PlaceholderDef[]).map((p) => p.key));
      const next = new Set(body.placeholders.map((p) => p.key));
      if (current.size !== next.size || [...current].some((k) => !next.has(k))) {
        throw badRequest('Daftar placeholder harus sama dengan tag di berkas templat; unggah versi baru untuk mengubah tag');
      }
      if (body.placeholders.some((p) => (SYSTEM_PLACEHOLDERS as readonly string[]).includes(p.key))) {
        throw badRequest('Placeholder sistem tidak dapat diubah');
      }
    }
    const updated = await prisma.documentTemplate.update({
      where: { id: t.id },
      data: {
        name: body.name,
        isActive: body.isActive,
        approvedByName: body.approvedByName,
        activeFrom: body.activeFrom !== undefined ? parseDateOnly(body.activeFrom) : undefined,
        placeholders: body.placeholders,
      },
    });
    await audit(prisma, ctxOf(req), {
      action: 'template.updated',
      entityType: 'DocumentTemplate',
      entityId: t.id,
      before: { name: t.name, isActive: t.isActive, approvedByName: t.approvedByName },
      after: body as Record<string, unknown>,
    });
    return updated;
  });

  // ---------------- outgoing letters

  app.get('/api/outgoing-letters', { preHandler: requireAuth }, async (req) => {
    const user = requireUser(req);
    const q = parse(outgoingListQuerySchema, req.query);
    const where: Prisma.OutgoingLetterWhereInput = {
      AND: [
        outgoingReadScope(user),
        ...(q.status ? [{ status: q.status }] : []),
        ...(q.type ? [{ type: q.type }] : []),
        ...(q.q
          ? [{ OR: [{ subject: { contains: q.q, mode: 'insensitive' as const } }, { number: { contains: q.q, mode: 'insensitive' as const } }, { recipient: { contains: q.q, mode: 'insensitive' as const } }] }]
          : []),
      ],
    };
    const [items, total] = await Promise.all([
      prisma.outgoingLetter.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true, type: true, number: true, subject: true, recipient: true, status: true, confidentiality: true,
          templateVersion: true, createdAt: true, finalizedAt: true, createdBy: userRef,
          links: { select: { incomingLetter: { select: { id: true, agendaNumber: true } } } },
        },
      }),
      prisma.outgoingLetter.count({ where }),
    ]);
    return { items, meta: pageMeta(q.page, q.pageSize, total) };
  });

  /** Letters awaiting review by the current official (separate from the read scope). */
  app.get('/api/outgoing-letters/review-queue', { preHandler: requirePermission('outgoing.review') }, async (req) => {
    const user = requireUser(req);
    const items = await prisma.outgoingLetter.findMany({
      where: { status: 'WAITING_REVIEW', deletedAt: null, createdById: { not: user.id }, confidentiality: { not: 'RAHASIA' } },
      orderBy: { updatedAt: 'asc' },
      select: { id: true, type: true, subject: true, recipient: true, status: true, createdAt: true, createdBy: userRef },
    });
    return { items };
  });

  app.post('/api/outgoing-letters', { preHandler: requirePermission('outgoing.create') }, async (req, reply) => {
    const input = parse(outgoingCreateSchema, req.body);
    const out = await createOutgoing(deps, ctxOf(req), input);
    return reply.code(201).send({ id: out.id });
  });

  app.get<{ Params: { id: string } }>('/api/outgoing-letters/:id', { preHandler: requireAuth }, async (req) => {
    const user = requireUser(req);
    const base = await findReadableOutgoing(prisma, user, req.params.id);
    const out = await prisma.outgoingLetter.findUniqueOrThrow({
      where: { id: base.id },
      include: {
        template: { select: { id: true, name: true, version: true, placeholders: true, type: true } },
        createdBy: userRef,
        reviewedBy: userRef,
        finalizedBy: userRef,
        documents: { where: { deletedAt: null }, select: { ...documentSelect, version: true }, orderBy: { version: 'desc' } },
        links: { select: { incomingLetter: { select: { id: true, agendaNumber: true, subject: true, senderName: true } } } },
        disposition: { select: { id: true, instruction: true, incomingLetterId: true } },
      },
    });
    const history = await prisma.auditLog.findMany({
      where: { entityType: 'OutgoingLetter', entityId: out.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, action: true, after: true, createdAt: true, actor: { select: { id: true, fullName: true } } },
    });
    return { ...out, history, actions: outgoingActions(user, base) };
  });

  app.patch<{ Params: { id: string } }>('/api/outgoing-letters/:id', { preHandler: requirePermission('outgoing.create') }, async (req) => {
    const input = parse(outgoingUpdateSchema, req.body);
    const out = await updateOutgoing(deps, ctxOf(req), req.params.id, input);
    return { id: out.id };
  });

  app.post<{ Params: { id: string } }>('/api/outgoing-letters/:id/submit', { preHandler: requirePermission('outgoing.create') }, async (req) => {
    await submitOutgoing(prisma, ctxOf(req), req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/outgoing-letters/:id/review', { preHandler: requirePermission('outgoing.review') }, async (req) => {
    const input = parse(reviewDecisionSchema, req.body);
    await reviewOutgoing(prisma, ctxOf(req), req.params.id, input.decision, input.note);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/outgoing-letters/:id/finalize', { preHandler: requirePermission('outgoing.finalize') }, async (req) => {
    const out = await finalizeOutgoing(deps, ctxOf(req), req.params.id);
    return { id: out.id, number: out.number };
  });

  app.post<{ Params: { id: string } }>('/api/outgoing-letters/:id/cancel', { preHandler: requireAuth }, async (req) => {
    const input = parse(reasonSchema, req.body);
    await cancelOutgoing(prisma, ctxOf(req), req.params.id, input.reason);
    return { ok: true };
  });
}
