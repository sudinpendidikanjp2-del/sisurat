import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  LETTER_STATUS_LABELS,
  LETTER_TYPE_LABELS,
  PRIORITY_LABELS,
  reportQuerySchema,
  type LetterStatus,
} from '@sisurat/shared';
import type { Deps } from '../../lib/deps';
import { requirePermission } from '../../plugins/auth';
import { ctxOf, parse, requireUser } from '../../lib/http';
import { letterReadScope } from '../../lib/authz';
import { addDays, parseDateOnly, startOfTodayUtc, toDateOnly } from '../../lib/dates';
import { getSettings } from '../../lib/settings';
import { audit } from '../../lib/audit';
import type { Prisma } from '../../generated/prisma/client';
import { buildLetterWhere } from '../letters/routes';

const ACTIVE_ASSIGNMENT = ['ASSIGNED', 'IN_PROGRESS', 'NEEDS_REVISION', 'WAITING_REVIEW'] as const;
const hours = (ms: number) => Math.round((ms / 3_600_000) * 10) / 10;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Neutralises spreadsheet formula injection and quotes CSV fields. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default async function reportRoutes(app: FastifyInstance, deps: Deps) {
  const { prisma } = deps;

  app.get('/api/dashboard', { preHandler: requirePermission('dashboard.read') }, async (req) => {
    const user = requireUser(req);
    const q = parse(z.object({ dateFrom: z.string().optional(), dateTo: z.string().optional() }), req.query);
    const today = startOfTodayUtc();
    const from = parseDateOnly(q.dateFrom) ?? addDays(today, -29);
    const to = parseDateOnly(q.dateTo) ?? today;
    const settings = await getSettings(prisma);
    const scope = letterReadScope(user);
    const inPeriod: Prisma.IncomingLetterWhereInput = { AND: [scope, { receivedDate: { gte: from, lte: to } }] };
    const scopedAssign: Prisma.AssignmentWhereInput = { disposition: { status: 'ACTIVE', incomingLetter: scope } };

    const [
      total,
      awaitingVerification,
      awaitingDisposition,
      activeDispositions,
      dueSoon,
      overdue,
      completed,
      failed,
      byStatus,
      timings,
      corrections,
      jobs,
      myActive,
      myOverdue,
      recent,
    ] = await Promise.all([
      prisma.incomingLetter.count({ where: inPeriod }),
      prisma.incomingLetter.count({ where: { AND: [scope, { status: 'DRAFT', processingStatus: { in: ['UPLOADED', 'NEEDS_REVIEW', 'PROCESSING_FAILED'] } }] } }),
      prisma.incomingLetter.count({ where: { AND: [scope, { status: 'AWAITING_DISPOSITION' }] } }),
      prisma.disposition.count({ where: { status: 'ACTIVE', incomingLetter: scope } }),
      prisma.assignment.count({ where: { ...scopedAssign, status: { in: [...ACTIVE_ASSIGNMENT] }, dueDate: { gte: today, lte: addDays(today, settings.deadlineReminderDays) } } }),
      prisma.assignment.count({ where: { ...scopedAssign, status: { in: [...ACTIVE_ASSIGNMENT] }, dueDate: { lt: today } } }),
      prisma.incomingLetter.count({ where: { AND: [scope, { status: { in: ['COMPLETED', 'ARCHIVED'] } }, { OR: [{ completedAt: { gte: from, lte: addDays(to, 1) } }, { archivedAt: { gte: from, lte: addDays(to, 1) } }] }] } }),
      prisma.incomingLetter.count({ where: { AND: [scope, { processingStatus: 'PROCESSING_FAILED', status: 'DRAFT' }] } }),
      prisma.incomingLetter.groupBy({ by: ['status'], where: inPeriod, _count: { _all: true } }),
      prisma.incomingLetter.findMany({ where: inPeriod, select: { createdAt: true, registeredAt: true, completedAt: true } }),
      prisma.metadataCorrection.count({ where: { createdAt: { gte: from, lt: addDays(to, 1) }, incomingLetter: scope } }),
      prisma.extractionJob.aggregate({
        where: { createdAt: { gte: from, lt: addDays(to, 1) }, incomingLetter: scope },
        _count: { _all: true },
        _sum: { estimatedCostUsd: true, inputTokens: true, outputTokens: true },
      }),
      prisma.assignment.count({ where: { assigneeId: user.id, status: { in: ['ASSIGNED', 'IN_PROGRESS', 'NEEDS_REVISION'] } } }),
      prisma.assignment.count({ where: { assigneeId: user.id, status: { in: ['ASSIGNED', 'IN_PROGRESS', 'NEEDS_REVISION'] }, dueDate: { lt: today } } }),
      prisma.incomingLetter.findMany({
        where: scope,
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, agendaNumber: true, subject: true, senderName: true, status: true, processingStatus: true, receivedDate: true },
      }),
    ]);
    const regTimes = timings.filter((t) => t.registeredAt).map((t) => t.registeredAt!.getTime() - t.createdAt.getTime());
    const doneTimes = timings.filter((t) => t.registeredAt && t.completedAt).map((t) => t.completedAt!.getTime() - t.registeredAt!.getTime());
    const failedJobs = await prisma.extractionJob.count({
      where: { status: 'FAILED', createdAt: { gte: from, lt: addDays(to, 1) }, incomingLetter: scope },
    });
    const cost = jobs._sum.estimatedCostUsd;

    return {
      period: { from: toDateOnly(from), to: toDateOnly(to) },
      counts: {
        totalIncoming: total,
        awaitingVerification,
        awaitingDisposition,
        activeDispositions,
        dueSoon,
        overdue,
        completed,
        processingFailed: failed,
        corrections,
        extractionJobs: jobs._count._all,
        failedJobs,
      },
      averages: {
        registrationHours: avg(regTimes) != null ? hours(avg(regTimes)!) : null,
        completionHours: avg(doneTimes) != null ? hours(avg(doneTimes)!) : null,
      },
      ai: {
        // Only reported when providers return usage and the admin has configured unit prices.
        estimatedCostUsd: cost != null ? Number(cost) : null,
        inputTokens: jobs._sum.inputTokens,
        outputTokens: jobs._sum.outputTokens,
      },
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
      mine: { activeAssignments: myActive, overdueAssignments: myOverdue },
      recent,
    };
  });

  async function reportRows(user: ReturnType<typeof requireUser>, q: z.infer<typeof reportQuerySchema>) {
    const where = buildLetterWhere(user, {
      status: q.status,
      letterType: q.letterType,
      sender: q.sender,
      assigneeId: q.assigneeId,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
    });
    return prisma.incomingLetter.findMany({
      where,
      orderBy: [{ receivedDate: 'asc' }, { agendaSeq: 'asc' }],
      take: 5000,
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
        priority: true,
        status: true,
        processingStatus: true,
        createdAt: true,
        registeredAt: true,
        completedAt: true,
        createdBy: { select: { fullName: true } },
        dispositions: {
          where: { status: { not: 'CANCELLED' } },
          select: { dueDate: true, assignments: { where: { status: { not: 'CANCELLED' } }, select: { status: true, dueDate: true, assignee: { select: { id: true, fullName: true } } } } },
        },
        _count: { select: { corrections: true } },
      },
    });
  }

  app.get('/api/reports/letters', { preHandler: requirePermission('report.read') }, async (req) => {
    const user = requireUser(req);
    const q = parse(reportQuerySchema, req.query);
    const rows = await reportRows(user, q);
    const today = startOfTodayUtc();

    const byStatus = new Map<string, number>();
    const byType = new Map<string, number>();
    const bySender = new Map<string, number>();
    const byAssignee = new Map<string, { name: string; total: number; completed: number; overdue: number }>();
    for (const r of rows) {
      byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
      byType.set(r.letterType ?? 'TIDAK_DIISI', (byType.get(r.letterType ?? 'TIDAK_DIISI') ?? 0) + 1);
      if (r.senderName) bySender.set(r.senderName, (bySender.get(r.senderName) ?? 0) + 1);
      for (const a of r.dispositions.flatMap((d) => d.assignments)) {
        const e = byAssignee.get(a.assignee.id) ?? { name: a.assignee.fullName, total: 0, completed: 0, overdue: 0 };
        e.total++;
        if (a.status === 'COMPLETED') e.completed++;
        else if (a.dueDate && a.dueDate < today) e.overdue++;
        byAssignee.set(a.assignee.id, e);
      }
    }
    const letterIds = rows.map((r) => r.id);
    const [jobStats, correctionStats] = await Promise.all([
      prisma.extractionJob.groupBy({
        by: ['method', 'provider', 'status'],
        where: { incomingLetterId: { in: letterIds } },
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true, estimatedCostUsd: true, pagesProcessed: true },
        _avg: { durationMs: true },
      }),
      prisma.metadataCorrection.groupBy({ by: ['field'], where: { incomingLetterId: { in: letterIds } }, _count: { _all: true } }),
    ]);
    const regTimes = rows.filter((r) => r.registeredAt).map((r) => r.registeredAt!.getTime() - r.createdAt.getTime());
    const doneTimes = rows.filter((r) => r.registeredAt && r.completedAt).map((r) => r.completedAt!.getTime() - r.registeredAt!.getTime());

    return {
      total: rows.length,
      truncated: rows.length >= 5000,
      byStatus: [...byStatus].map(([status, count]) => ({ status, count })),
      byType: [...byType].map(([type, count]) => ({ type, count })),
      topSenders: [...bySender].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([sender, count]) => ({ sender, count })),
      byAssignee: [...byAssignee.values()].sort((a, b) => b.total - a.total),
      processing: jobStats.map((j) => ({
        method: j.method,
        provider: j.provider,
        status: j.status,
        count: j._count._all,
        inputTokens: j._sum.inputTokens,
        outputTokens: j._sum.outputTokens,
        pages: j._sum.pagesProcessed,
        estimatedCostUsd: j._sum.estimatedCostUsd != null ? Number(j._sum.estimatedCostUsd) : null,
        avgDurationMs: j._avg.durationMs != null ? Math.round(j._avg.durationMs) : null,
      })),
      corrections: correctionStats.map((c) => ({ field: c.field, count: c._count._all })),
      averages: {
        registrationHours: avg(regTimes) != null ? hours(avg(regTimes)!) : null,
        completionHours: avg(doneTimes) != null ? hours(avg(doneTimes)!) : null,
      },
    };
  });

  app.get('/api/reports/letters.csv', { preHandler: requirePermission('report.export') }, async (req, reply) => {
    const user = requireUser(req);
    const q = parse(reportQuerySchema, req.query);
    const rows = await reportRows(user, q);
    const header = [
      'No. Agenda', 'Nomor Surat', 'Tanggal Surat', 'Tanggal Diterima', 'Pengirim', 'Penerima', 'Perihal',
      'Jenis', 'Prioritas', 'Status', 'Pencatat', 'Penanggung Jawab', 'Tenggat', 'Jumlah Koreksi',
    ];
    const lines = [header.join(',')];
    for (const r of rows) {
      const assignments = r.dispositions.flatMap((d) => d.assignments);
      const dues = assignments.map((a) => a.dueDate).filter(Boolean) as Date[];
      lines.push(
        [
          r.agendaNumber,
          r.letterNumber,
          r.letterDate,
          r.receivedDate,
          r.senderName,
          r.recipientName,
          r.subject,
          r.letterType ? LETTER_TYPE_LABELS[r.letterType] : '',
          PRIORITY_LABELS[r.priority],
          LETTER_STATUS_LABELS[r.status as LetterStatus],
          r.createdBy.fullName,
          [...new Set(assignments.map((a) => a.assignee.fullName))].join('; '),
          dues.length ? new Date(Math.min(...dues.map((d) => d.getTime()))) : '',
          r._count.corrections,
        ]
          .map(csvCell)
          .join(','),
      );
    }
    await audit(prisma, ctxOf(req), {
      action: 'report.exported',
      entityType: 'Report',
      entityId: 'letters',
      after: { filters: q, rows: rows.length },
    });
    const filename = `register-surat-${toDateOnly(new Date())}.csv`;
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Cache-Control', 'private, no-store');
    return '﻿' + lines.join('\r\n');
  });
}
