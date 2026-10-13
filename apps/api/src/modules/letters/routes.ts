import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AI_PROVIDERS,
  letterArchiveSchema,
  letterCreateSchema,
  letterForwardSchema,
  letterListQuerySchema,
  letterMetadataSchema,
  letterVerifySchema,
  reasonSchema,
} from '@sisurat/shared';
import type { Deps } from '../../lib/deps';
import { requireAuth, requirePermission } from '../../plugins/auth';
import { ctxOf, pageMeta, parse, requireUser } from '../../lib/http';
import { letterReadScope } from '../../lib/authz';
import { parseDateOnly } from '../../lib/dates';
import { withIdempotency } from '../../lib/idempotency';
import { parseJsonField, readMultipart } from '../../lib/uploads';
import { getSettings } from '../../lib/settings';
import { invalidState, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { enqueueExtraction } from '../../jobs/extraction';
import type { Prisma } from '../../generated/prisma/client';
import {
  addDocuments,
  allowedActions,
  archiveLetter,
  cancelLetter,
  createLetter,
  findReadableLetter,
  forwardLetter,
  updateLetter,
  verifyLetter,
} from './service';

export const documentSelect = {
  id: true,
  kind: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  pageCount: true,
  checksumSha256: true,
  createdAt: true,
  uploadedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.DocumentSelect;

const userRef = { select: { id: true, fullName: true, position: true } } as const;

export function buildLetterWhere(
  user: Parameters<typeof letterReadScope>[0],
  q: Partial<z.infer<typeof letterListQuerySchema>>,
): Prisma.IncomingLetterWhereInput {
  const and: Prisma.IncomingLetterWhereInput[] = [letterReadScope(user)];
  if (q.q) {
    and.push({
      OR: [
        { subject: { contains: q.q, mode: 'insensitive' } },
        { letterNumber: { contains: q.q, mode: 'insensitive' } },
        { agendaNumber: { contains: q.q, mode: 'insensitive' } },
        { senderName: { contains: q.q, mode: 'insensitive' } },
        { summary: { contains: q.q, mode: 'insensitive' } },
      ],
    });
  }
  if (q.status) and.push({ status: q.status });
  if (q.archived === 'true') and.push({ status: 'ARCHIVED' });
  if (q.archived === 'false') and.push({ status: { not: 'ARCHIVED' } });
  if (q.processingStatus) and.push({ processingStatus: q.processingStatus });
  if (q.letterType) and.push({ letterType: q.letterType });
  if (q.priority) and.push({ priority: q.priority });
  if (q.sender) and.push({ senderName: { contains: q.sender, mode: 'insensitive' } });
  if (q.assigneeId) and.push({ dispositions: { some: { assignments: { some: { assigneeId: q.assigneeId } } } } });
  if (q.dateFrom) and.push({ receivedDate: { gte: parseDateOnly(q.dateFrom)! } });
  if (q.dateTo) and.push({ receivedDate: { lte: parseDateOnly(q.dateTo)! } });
  return { AND: and };
}

export default async function letterRoutes(app: FastifyInstance, deps: Deps) {
  const { prisma } = deps;

  app.get('/api/incoming-letters', { preHandler: requireAuth }, async (req) => {
    const user = requireUser(req);
    const q = parse(letterListQuerySchema, req.query);
    const where = buildLetterWhere(user, q);
    const [items, total] = await Promise.all([
      prisma.incomingLetter.findMany({
        where,
        orderBy: [
          ['letterDate', 'agendaNumber'].includes(q.sort) ? { [q.sort]: { sort: q.order, nulls: 'last' } } : { [q.sort]: q.order },
          { id: 'desc' },
        ],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          agendaNumber: true,
          letterNumber: true,
          letterDate: true,
          receivedDate: true,
          senderName: true,
          recipientName: true,
          subject: true,
          letterType: true,
          summary: true,
          priority: true,
          confidentiality: true,
          status: true,
          processingStatus: true,
          createdAt: true,
          createdBy: userRef,
          forwardedTo: userRef,
          _count: { select: { documents: { where: { deletedAt: null } } } },
          dispositions: {
            where: { status: { not: 'CANCELLED' } },
            select: {
              dueDate: true,
              assignments: { where: { status: { not: 'CANCELLED' } }, select: { assignee: userRef, dueDate: true, status: true } },
            },
          },
        },
      }),
      prisma.incomingLetter.count({ where }),
    ]);
    return {
      items: items.map(({ dispositions, _count, ...l }) => {
        const assignments = dispositions.flatMap((d) => d.assignments);
        const dues = assignments.map((a) => a.dueDate).concat(dispositions.map((d) => d.dueDate)).filter(Boolean) as Date[];
        return {
          ...l,
          documentCount: _count.documents,
          assignees: [...new Map(assignments.map((a) => [a.assignee.id, a.assignee])).values()],
          dueDate: dues.length ? new Date(Math.min(...dues.map((d) => d.getTime()))) : null,
        };
      }),
      meta: pageMeta(q.page, q.pageSize, total),
    };
  });

  app.post('/api/incoming-letters', { preHandler: requirePermission('letter.create') }, async (req, reply) => {
    const ctx = ctxOf(req);
    const settings = await getSettings(prisma);
    return withIdempotency(prisma, req, reply, 'incoming-letters.create', async () => {
      const { fields, files } = await readMultipart(req, {
        maxFiles: settings.maxFilesPerLetter,
        maxBytes: settings.maxUploadMb * 1024 * 1024,
      });
      const input = parse(letterCreateSchema, parseJsonField(fields, 'metadata'));
      const res = await createLetter(deps, ctx, input, files);
      return {
        status: 201,
        body: { id: res.letter.id, documents: res.documents.map((d) => d.id), jobId: res.job?.id ?? null },
      };
    });
  });

  app.get<{ Params: { id: string } }>('/api/incoming-letters/:id', { preHandler: requireAuth }, async (req) => {
    const user = requireUser(req);
    const base = await findReadableLetter(prisma, user, req.params.id);
    const letter = await prisma.incomingLetter.findUniqueOrThrow({
      where: { id: base.id },
      include: {
        createdBy: userRef,
        verifiedBy: userRef,
        forwardedTo: userRef,
        documents: { where: { deletedAt: null }, select: documentSelect, orderBy: { createdAt: 'asc' } },
        extractionJobs: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { result: { select: { id: true, normalizedFields: true, reviewFlags: true, evidence: true, reviewedAt: true, extractedTextChars: true } }, requestedBy: userRef },
        },
        dispositions: {
          orderBy: { createdAt: 'desc' },
          include: {
            issuer: userRef,
            assignments: {
              orderBy: { createdAt: 'asc' },
              include: { assignee: userRef, updates: { orderBy: { createdAt: 'asc' }, include: { author: userRef, attachments: { where: { deletedAt: null }, select: documentSelect } } } },
            },
          },
        },
        corrections: { orderBy: { createdAt: 'desc' }, include: { correctedBy: userRef } },
        outgoingLinks: { include: { outgoingLetter: { select: { id: true, number: true, subject: true, status: true, type: true } } } },
      },
    });
    const activeDispositions = letter.dispositions.filter((d) => d.status === 'ACTIVE').length;
    const jobs = letter.extractionJobs.map((j) => ({ ...j, estimatedCostUsd: j.estimatedCostUsd != null ? Number(j.estimatedCostUsd) : null }));
    return { ...letter, extractionJobs: jobs, actions: allowedActions(user, base, { activeDispositions }) };
  });

  app.get<{ Params: { id: string } }>('/api/incoming-letters/:id/history', { preHandler: requireAuth }, async (req) => {
    const user = requireUser(req);
    const letter = await findReadableLetter(prisma, user, req.params.id);
    const related = await prisma.incomingLetter.findUniqueOrThrow({
      where: { id: letter.id },
      select: {
        extractionJobs: { select: { id: true } },
        dispositions: { select: { id: true, assignments: { select: { id: true } } } },
      },
    });
    const ids = [
      letter.id,
      ...related.extractionJobs.map((j) => j.id),
      ...related.dispositions.flatMap((d) => [d.id, ...d.assignments.map((a) => a.id)]),
    ];
    const logs = await prisma.auditLog.findMany({
      where: { entityId: { in: ids } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, action: true, entityType: true, summary: true, before: true, after: true, createdAt: true, actor: { select: { id: true, fullName: true } } },
    });
    return { items: logs };
  });

  app.patch<{ Params: { id: string } }>(
    '/api/incoming-letters/:id',
    { preHandler: requirePermission('letter.update') },
    async (req) => {
      const input = parse(letterMetadataSchema.partial(), req.body);
      const updated = await updateLetter(prisma, ctxOf(req), req.params.id, input);
      return { id: updated.id };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/incoming-letters/:id/documents',
    { preHandler: requirePermission('letter.create') },
    async (req, reply) => {
      const settings = await getSettings(prisma);
      const { files } = await readMultipart(req, {
        maxFiles: settings.maxFilesPerLetter,
        maxBytes: settings.maxUploadMb * 1024 * 1024,
      });
      const docs = await addDocuments(deps, ctxOf(req), req.params.id, files);
      return reply.code(201).send({ documents: docs.map((d) => d.id) });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/incoming-letters/:id/verify',
    { preHandler: requirePermission('letter.verify') },
    async (req) => {
      const input = parse(letterVerifySchema, req.body);
      const letter = await verifyLetter(prisma, ctxOf(req), req.params.id, input);
      return { id: letter.id, agendaNumber: letter.agendaNumber, status: letter.status };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/incoming-letters/:id/forward',
    { preHandler: requirePermission('letter.forward') },
    async (req) => {
      const input = parse(letterForwardSchema, req.body);
      const letter = await forwardLetter(prisma, ctxOf(req), req.params.id, input);
      return { id: letter.id, status: letter.status };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/incoming-letters/:id/archive',
    { preHandler: requirePermission('letter.archive') },
    async (req) => {
      const input = parse(letterArchiveSchema, req.body ?? {});
      const letter = await archiveLetter(prisma, ctxOf(req), req.params.id, input.note);
      return { id: letter.id, status: letter.status };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/incoming-letters/:id/cancel',
    { preHandler: requirePermission('letter.delete') },
    async (req) => {
      const input = parse(reasonSchema, req.body);
      const letter = await cancelLetter(prisma, ctxOf(req), req.params.id, input.reason);
      return { id: letter.id, status: letter.status };
    },
  );

  // ---------------- extraction

  app.post<{ Params: { id: string } }>(
    '/api/documents/:id/extract',
    { preHandler: requirePermission('extraction.run') },
    async (req, reply) => {
      const user = requireUser(req);
      const body = parse(z.object({ provider: z.enum(AI_PROVIDERS).optional() }), req.body ?? {});
      const doc = await prisma.document.findFirst({ where: { id: req.params.id, deletedAt: null } });
      if (!doc?.incomingLetterId) throw notFound('Dokumen tidak ditemukan');
      const letter = await findReadableLetter(prisma, user, doc.incomingLetterId);
      if (letter.status !== 'DRAFT') throw invalidState('Ekstraksi hanya untuk surat yang belum terdaftar');
      const { job, created } = await enqueueExtraction(prisma, {
        documentId: doc.id,
        requestedById: user.id,
        requestedProvider: body.provider ?? null,
      });
      if (created) {
        await audit(prisma, ctxOf(req), {
          action: 'extraction.requested',
          entityType: 'ExtractionJob',
          entityId: job.id,
          after: { documentId: doc.id, provider: body.provider ?? 'default' },
        });
        deps.onJobEnqueued?.();
      }
      return reply.code(created ? 202 : 200).send({ jobId: job.id, status: job.status, created });
    },
  );

  app.get<{ Params: { id: string } }>('/api/extraction-jobs/:id', { preHandler: requireAuth }, async (req) => {
    const user = requireUser(req);
    const job = await prisma.extractionJob.findUnique({
      where: { id: req.params.id },
      include: { result: { select: { id: true, normalizedFields: true, reviewFlags: true, evidence: true, reviewedAt: true } } },
    });
    if (!job) throw notFound('Job tidak ditemukan');
    await findReadableLetter(prisma, user, job.incomingLetterId);
    return { ...job, estimatedCostUsd: job.estimatedCostUsd != null ? Number(job.estimatedCostUsd) : null };
  });
}
