import type { FastifyInstance } from 'fastify';
import {
  assignmentListQuerySchema,
  dispositionCreateSchema,
  reassignSchema,
  reasonSchema,
  reviewDecisionSchema,
  workUpdateSchema,
} from '@sisurat/shared';
import type { Deps } from '../../lib/deps';
import { requireAuth, requirePermission } from '../../plugins/auth';
import { ctxOf, pageMeta, parse, requireUser } from '../../lib/http';
import { can, letterReadScope } from '../../lib/authz';
import { forbidden, notFound } from '../../lib/errors';
import { readMultipart } from '../../lib/uploads';
import { getSettings } from '../../lib/settings';
import { startOfTodayUtc } from '../../lib/dates';
import type { Prisma } from '../../generated/prisma/client';
import { documentSelect } from '../letters/routes';
import {
  addWorkUpdate,
  assertAssignmentReadable,
  cancelAssignment,
  cancelDisposition,
  createDisposition,
  reassignAssignment,
  reviewAssignment,
  startAssignment,
} from './service';

const userRef = { select: { id: true, fullName: true, position: true } } as const;

export default async function dispositionRoutes(app: FastifyInstance, deps: Deps) {
  const { prisma } = deps;

  app.post<{ Params: { id: string } }>(
    '/api/incoming-letters/:id/dispositions',
    { preHandler: requirePermission('disposition.create') },
    async (req, reply) => {
      const input = parse(dispositionCreateSchema, req.body);
      const d = await createDisposition(prisma, ctxOf(req), req.params.id, input);
      return reply.code(201).send({ id: d.id, assignments: d.assignments.map((a) => a.id) });
    },
  );

  app.post<{ Params: { id: string } }>('/api/dispositions/:id/cancel', { preHandler: requireAuth }, async (req) => {
    const input = parse(reasonSchema, req.body);
    await cancelDisposition(prisma, ctxOf(req), req.params.id, input.reason);
    return { ok: true };
  });

  app.get('/api/assignments', { preHandler: requireAuth }, async (req) => {
    const user = requireUser(req);
    const q = parse(assignmentListQuerySchema, req.query);
    const and: Prisma.AssignmentWhereInput[] = [];
    if (q.scope === 'mine') and.push({ assigneeId: user.id });
    else if (q.scope === 'review') {
      if (!can(user, 'disposition.create') && !can(user, 'disposition.review')) throw forbidden();
      and.push({ disposition: { issuerId: user.id } });
    } else {
      if (!can(user, 'letter.read_all')) throw forbidden();
      and.push({ disposition: { incomingLetter: letterReadScope(user) } });
    }
    if (q.status) and.push({ status: q.status });
    if (q.overdue === 'true') {
      and.push({ dueDate: { lt: startOfTodayUtc() }, status: { in: ['ASSIGNED', 'IN_PROGRESS', 'NEEDS_REVISION'] } });
    }
    const where: Prisma.AssignmentWhereInput = { AND: and };
    const [items, total] = await Promise.all([
      prisma.assignment.findMany({
        where,
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          assignee: userRef,
          disposition: {
            select: {
              id: true,
              instruction: true,
              priority: true,
              issuer: userRef,
              incomingLetter: { select: { id: true, agendaNumber: true, subject: true, senderName: true, confidentiality: true } },
            },
          },
        },
      }),
      prisma.assignment.count({ where }),
    ]);
    return { items, meta: pageMeta(q.page, q.pageSize, total) };
  });

  app.get<{ Params: { id: string } }>('/api/assignments/:id', { preHandler: requireAuth }, async (req) => {
    const user = requireUser(req);
    const base = await prisma.assignment.findUnique({
      where: { id: req.params.id },
      include: { disposition: { include: { incomingLetter: true } }, assignee: { select: { id: true, fullName: true } } },
    });
    if (!base) throw notFound('Penugasan tidak ditemukan');
    await assertAssignmentReadable(prisma, user, base);
    const a = await prisma.assignment.findUniqueOrThrow({
      where: { id: base.id },
      include: {
        assignee: userRef,
        assignedBy: userRef,
        reassignedFrom: { select: { id: true, assignee: userRef } },
        reassignedTo: { select: { id: true, assignee: userRef } },
        updates: {
          orderBy: { createdAt: 'asc' },
          include: { author: userRef, attachments: { where: { deletedAt: null }, select: documentSelect } },
        },
        disposition: {
          include: {
            issuer: userRef,
            assignments: { select: { id: true, status: true, assignee: userRef } },
            outgoingLetters: { where: { deletedAt: null }, select: { id: true, number: true, subject: true, status: true, type: true } },
            incomingLetter: {
              select: {
                id: true,
                agendaNumber: true,
                letterNumber: true,
                letterDate: true,
                senderName: true,
                subject: true,
                summary: true,
                status: true,
                confidentiality: true,
                documents: { where: { deletedAt: null }, select: documentSelect },
              },
            },
          },
        },
      },
    });
    const isAssignee = a.assigneeId === user.id;
    const isReviewer = a.disposition.issuerId === user.id || can(user, 'disposition.review');
    const open = !['COMPLETED', 'CANCELLED'].includes(a.status);
    return {
      ...a,
      actions: {
        start: isAssignee && a.status === 'ASSIGNED',
        update: isAssignee && ['ASSIGNED', 'IN_PROGRESS', 'NEEDS_REVISION'].includes(a.status) && can(user, 'assignment.work'),
        review: isReviewer && a.status === 'WAITING_REVIEW',
        cancel: isReviewer && open,
        reassign: isReviewer && open,
        createReply: (isAssignee || isReviewer) && can(user, 'outgoing.create'),
      },
    };
  });

  app.post<{ Params: { id: string } }>(
    '/api/assignments/:id/start',
    { preHandler: requirePermission('assignment.work') },
    async (req) => {
      await startAssignment(prisma, ctxOf(req), req.params.id);
      return { ok: true };
    },
  );

  /** Accepts JSON or multipart (fields: note, progressPercent, submitForReview; files: evidence). */
  app.post<{ Params: { id: string } }>(
    '/api/assignments/:id/updates',
    { preHandler: requirePermission('assignment.work') },
    async (req, reply) => {
      let body: unknown = req.body;
      let files: Awaited<ReturnType<typeof readMultipart>>['files'] = [];
      if (req.isMultipart()) {
        const settings = await getSettings(prisma);
        const mp = await readMultipart(req, { maxFiles: 10, maxBytes: settings.maxUploadMb * 1024 * 1024 });
        files = mp.files;
        body = {
          note: mp.fields.note,
          progressPercent: mp.fields.progressPercent || undefined,
          submitForReview: mp.fields.submitForReview === 'true',
        };
      }
      const input = parse(workUpdateSchema, body);
      const update = await addWorkUpdate(deps, ctxOf(req), req.params.id, input, files);
      return reply.code(201).send({ id: update.id });
    },
  );

  app.post<{ Params: { id: string } }>('/api/assignments/:id/review', { preHandler: requireAuth }, async (req) => {
    const input = parse(reviewDecisionSchema, req.body);
    await reviewAssignment(prisma, ctxOf(req), req.params.id, input);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/assignments/:id/cancel', { preHandler: requireAuth }, async (req) => {
    const input = parse(reasonSchema, req.body);
    await cancelAssignment(prisma, ctxOf(req), req.params.id, input.reason);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/assignments/:id/reassign', { preHandler: requireAuth }, async (req, reply) => {
    const input = parse(reassignSchema, req.body);
    const created = await reassignAssignment(prisma, ctxOf(req), req.params.id, input.newAssigneeId, input.reason);
    return reply.code(201).send({ id: created.id });
  });
}
