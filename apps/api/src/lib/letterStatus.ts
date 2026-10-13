import type { DbOrTx } from '../db';
import type { LetterStatus } from '../generated/prisma/client';

/**
 * Derives the follow-up status of an incoming letter from its active assignments.
 * Letters that are archived/cancelled or not yet dispositioned are left untouched.
 */
export async function recomputeLetterStatus(db: DbOrTx, letterId: string): Promise<LetterStatus> {
  const letter = await db.incomingLetter.findUniqueOrThrow({
    where: { id: letterId },
    include: { dispositions: { where: { status: { not: 'CANCELLED' } }, include: { assignments: true } } },
  });
  if (['ARCHIVED', 'CANCELLED', 'DRAFT', 'REGISTERED'].includes(letter.status)) return letter.status;

  const active = letter.dispositions.flatMap((d) => d.assignments).filter((a) => a.status !== 'CANCELLED');
  let next: LetterStatus;
  if (letter.dispositions.length === 0 || active.length === 0) next = 'AWAITING_DISPOSITION';
  else if (active.some((a) => a.status === 'NEEDS_REVISION')) next = 'NEEDS_REVISION';
  else if (active.some((a) => a.status === 'WAITING_REVIEW')) next = 'WAITING_REVIEW';
  else if (active.some((a) => a.status === 'IN_PROGRESS')) next = 'IN_PROGRESS';
  else if (active.every((a) => a.status === 'COMPLETED')) next = 'COMPLETED';
  else next = 'ASSIGNED';

  if (next !== letter.status) {
    await db.incomingLetter.update({
      where: { id: letterId },
      data: { status: next, completedAt: next === 'COMPLETED' ? new Date() : null },
    });
  }
  return next;
}
