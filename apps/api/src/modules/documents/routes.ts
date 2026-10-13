import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../lib/deps';
import type { AuthUser } from '../../lib/context';
import { requireAuth } from '../../plugins/auth';
import { ctxOf, parse, requireUser } from '../../lib/http';
import { can, outgoingReadScope } from '../../lib/authz';
import { forbidden, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { findReadableLetter } from '../letters/service';
import type { Db } from '../../db';
import type { Document } from '../../generated/prisma/client';

/** Object-level check: a document is readable when its parent record is readable. */
export async function assertDocumentReadable(prisma: Db, user: AuthUser, doc: Document) {
  if (doc.incomingLetterId) {
    await findReadableLetter(prisma, user, doc.incomingLetterId);
    return;
  }
  if (doc.workUpdateId) {
    const wu = await prisma.workUpdate.findUnique({
      where: { id: doc.workUpdateId },
      include: { assignment: { include: { disposition: true } } },
    });
    if (!wu) throw notFound('Dokumen tidak ditemukan');
    const a = wu.assignment;
    if (a.assigneeId === user.id || a.disposition.issuerId === user.id) return;
    await findReadableLetter(prisma, user, a.disposition.incomingLetterId);
    return;
  }
  if (doc.outgoingLetterId) {
    const out = await prisma.outgoingLetter.findFirst({ where: { AND: [{ id: doc.outgoingLetterId }, outgoingReadScope(user)] } });
    if (out) return;
    if (can(user, 'outgoing.review')) {
      const pending = await prisma.outgoingLetter.findFirst({
        where: { id: doc.outgoingLetterId, status: 'WAITING_REVIEW', deletedAt: null, confidentiality: { not: 'RAHASIA' } },
      });
      if (pending) return;
    }
    throw notFound('Dokumen tidak ditemukan');
  }
  if (doc.templateId) {
    if (can(user, 'template.manage') || can(user, 'outgoing.create')) return;
    throw forbidden();
  }
  throw notFound('Dokumen tidak ditemukan');
}

function contentDisposition(type: 'inline' | 'attachment', filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export default async function documentRoutes(app: FastifyInstance, deps: Deps) {
  const { prisma, storage } = deps;

  app.get<{ Params: { id: string } }>('/api/documents/:id/content', { preHandler: requireAuth }, async (req, reply) => {
    const user = requireUser(req);
    const q = parse(z.object({ download: z.enum(['1', '0']).optional() }), req.query);
    const doc = await prisma.document.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!doc) throw notFound('Dokumen tidak ditemukan');
    await assertDocumentReadable(prisma, user, doc);
    if (!(await storage.exists(doc.storageKey))) throw notFound('Berkas tidak ditemukan di penyimpanan');

    const inlineAllowed = ['application/pdf', 'image/png', 'image/jpeg'].includes(doc.mimeType);
    const mode = q.download === '1' || !inlineAllowed ? 'attachment' : 'inline';
    await audit(prisma, ctxOf(req), {
      action: mode === 'attachment' ? 'document.downloaded' : 'document.viewed',
      entityType: 'Document',
      entityId: doc.id,
      summary: doc.originalName,
    });
    reply
      .header('Content-Type', doc.mimeType)
      .header('Content-Length', doc.sizeBytes)
      .header('Content-Disposition', contentDisposition(mode, doc.originalName))
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff');
    return reply.send(storage.stream(doc.storageKey));
  });
}
