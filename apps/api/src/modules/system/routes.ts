import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AI_PROVIDERS, appSettingsSchema, auditQuerySchema, paginationSchema, providerConfigSchema } from '@sisurat/shared';
import type { Deps } from '../../lib/deps';
import { requireAuth, requirePermission } from '../../plugins/auth';
import { ctxOf, pageMeta, parse, requireUser } from '../../lib/http';
import { getSettings, saveSettings } from '../../lib/settings';
import { audit } from '../../lib/audit';
import { parseDateOnly, addDays } from '../../lib/dates';
import { notFound } from '../../lib/errors';
import type { Prisma } from '../../generated/prisma/client';

export default async function systemRoutes(app: FastifyInstance, deps: Deps) {
  const { prisma, ai } = deps;

  // ---------------- notifications
  app.get('/api/notifications', { preHandler: requireAuth }, async (req) => {
    const user = requireUser(req);
    const q = parse(paginationSchema.extend({ unread: z.enum(['true', 'false']).optional() }), req.query);
    const where: Prisma.NotificationWhereInput = { userId: user.id, ...(q.unread === 'true' && { readAt: null }) };
    const [items, total, unread] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return { items, unread, meta: pageMeta(q.page, q.pageSize, total) };
  });

  app.post<{ Params: { id: string } }>('/api/notifications/:id/read', { preHandler: requireAuth }, async (req) => {
    const user = requireUser(req);
    const res = await prisma.notification.updateMany({ where: { id: req.params.id, userId: user.id }, data: { readAt: new Date() } });
    if (res.count === 0) throw notFound('Notifikasi tidak ditemukan');
    return { ok: true };
  });

  app.post('/api/notifications/read-all', { preHandler: requireAuth }, async (req) => {
    const user = requireUser(req);
    await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  });

  // ---------------- settings
  /** Non-sensitive settings every signed-in user needs (upload limits, organisation name). */
  app.get('/api/settings/public', { preHandler: requireAuth }, async () => {
    const s = await getSettings(prisma);
    return {
      organizationName: s.organizationName,
      maxUploadMb: s.maxUploadMb,
      maxPdfPages: s.maxPdfPages,
      maxFilesPerLetter: s.maxFilesPerLetter,
      autoExtractOnUpload: s.autoExtractOnUpload,
      aiEnabled: s.aiEnabled,
    };
  });

  app.get('/api/settings', { preHandler: requirePermission('config.manage') }, async () => getSettings(prisma));

  app.put('/api/settings', { preHandler: requirePermission('config.manage') }, async (req) => {
    const body = parse(appSettingsSchema, req.body);
    const before = await getSettings(prisma);
    await saveSettings(prisma, body, req.user!.id);
    await audit(prisma, ctxOf(req), { action: 'settings.updated', entityType: 'AppSetting', entityId: 'app', before, after: body });
    return body;
  });

  app.get('/api/ai-providers', { preHandler: requirePermission('config.manage') }, async () => {
    const rows = await prisma.aiProviderConfig.findMany({ orderBy: { provider: 'asc' } });
    const status = Object.fromEntries(ai.providerStatus().map((s) => [s.provider, s.configured]));
    const ocr = await ai.ocrAvailable();
    return {
      items: rows.map((r) => ({
        ...r,
        inputCostPerMTokUsd: r.inputCostPerMTokUsd != null ? Number(r.inputCostPerMTokUsd) : null,
        outputCostPerMTokUsd: r.outputCostPerMTokUsd != null ? Number(r.outputCostPerMTokUsd) : null,
        external: r.provider !== 'TESSERACT',
        // Only whether a credential exists — the key itself never leaves the server.
        credentialConfigured: r.provider === 'TESSERACT' ? ocr : Boolean(status[r.provider]),
      })),
    };
  });

  app.put<{ Params: { provider: string } }>('/api/ai-providers/:provider', { preHandler: requirePermission('config.manage') }, async (req) => {
    const provider = parse(z.enum(AI_PROVIDERS), req.params.provider);
    const body = parse(providerConfigSchema, req.body);
    const before = await prisma.aiProviderConfig.findUnique({ where: { provider } });
    const data = {
      ...body,
      // A local engine never sends data out; external approval is meaningful only for Gemini/Claude.
      approvedForExternal: provider === 'TESSERACT' ? false : body.approvedForExternal,
      notes: body.notes ?? null,
      inputCostPerMTokUsd: body.inputCostPerMTokUsd ?? null,
      outputCostPerMTokUsd: body.outputCostPerMTokUsd ?? null,
      updatedById: req.user!.id,
    };
    const row = await prisma.aiProviderConfig.upsert({ where: { provider }, create: { provider, ...data }, update: data });
    await audit(prisma, ctxOf(req), {
      action: 'ai_provider.updated',
      entityType: 'AiProviderConfig',
      entityId: provider,
      before: before ? { ...before, inputCostPerMTokUsd: before.inputCostPerMTokUsd?.toString(), outputCostPerMTokUsd: before.outputCostPerMTokUsd?.toString() } : null,
      after: data,
    });
    return { provider: row.provider };
  });

  // ---------------- audit log
  app.get('/api/audit-logs', { preHandler: requirePermission('audit.read') }, async (req) => {
    const q = parse(auditQuerySchema, req.query);
    const where: Prisma.AuditLogWhereInput = {
      ...(q.action && { action: { contains: q.action } }),
      ...(q.entityType && { entityType: q.entityType }),
      ...(q.entityId && { entityId: q.entityId }),
      ...(q.actorId && { actorId: q.actorId }),
      ...((q.dateFrom || q.dateTo) && {
        createdAt: {
          ...(q.dateFrom && { gte: parseDateOnly(q.dateFrom)! }),
          ...(q.dateTo && { lt: addDays(parseDateOnly(q.dateTo)!, 1) }),
        },
      }),
    };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { actor: { select: { id: true, fullName: true, username: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);
    return { items, meta: pageMeta(q.page, q.pageSize, total) };
  });
}
