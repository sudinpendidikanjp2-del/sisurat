import type { Db } from '../db';
import { Prisma } from '../generated/prisma/client';
import { getSettings } from '../lib/settings';
import { notify, type NotificationInput } from '../lib/notify';
import { addDays, startOfTodayUtc, toDateOnly } from '../lib/dates';

/** Creates "deadline approaching" and "overdue" notifications. Safe to run repeatedly (dedupe keys). */
export async function scanDeadlines(db: Db, now = new Date()) {
  const settings = await getSettings(db);
  const today = startOfTodayUtc(now);
  const soon = addDays(today, settings.deadlineReminderDays);
  const assignments = await db.assignment.findMany({
    where: { status: { in: ['ASSIGNED', 'IN_PROGRESS', 'NEEDS_REVISION'] }, dueDate: { not: null, lte: soon } },
    include: { disposition: { include: { incomingLetter: { select: { id: true, subject: true, agendaNumber: true } } } } },
  });
  const items: NotificationInput[] = [];
  for (const a of assignments) {
    const letter = a.disposition.incomingLetter;
    const label = `${letter.agendaNumber ?? ''} ${letter.subject ?? ''}`.trim();
    const due = toDateOnly(a.dueDate)!;
    if (a.dueDate! < today) {
      for (const userId of new Set([a.assigneeId, a.disposition.issuerId])) {
        items.push({
          userId,
          type: 'OVERDUE',
          title: 'Tindak lanjut terlambat',
          message: `Tugas "${label}" melewati tenggat ${due}.`,
          entityType: 'Assignment',
          entityId: a.id,
          link: `/tugas/${a.id}`,
          dedupeKey: `overdue:${a.id}:${due}:${userId}`,
        });
      }
    } else {
      items.push({
        userId: a.assigneeId,
        type: 'DEADLINE_APPROACHING',
        title: 'Tenggat mendekat',
        message: `Tugas "${label}" bertenggat ${due}.`,
        entityType: 'Assignment',
        entityId: a.id,
        link: `/tugas/${a.id}`,
        dedupeKey: `due:${a.id}:${due}`,
      });
    }
  }
  return notify(db, items);
}

/** Applies the retention policy for raw AI output and cleans expired sessions/idempotency keys. */
export async function runRetention(db: Db, now = new Date()) {
  const settings = await getSettings(db);
  let purged = 0;
  if (settings.rawResultRetentionDays > 0) {
    const cutoff = addDays(now, -settings.rawResultRetentionDays);
    const res = await db.extractionResult.updateMany({
      where: { createdAt: { lt: cutoff }, rawPurgedAt: null },
      data: { rawOutput: Prisma.DbNull, rawPurgedAt: now },
    });
    purged = res.count;
  }
  await db.session.deleteMany({ where: { expiresAt: { lt: now } } });
  await db.idempotencyRecord.deleteMany({ where: { createdAt: { lt: addDays(now, -2) } } });
  return { purged };
}
