import type { Permission } from '@sisurat/shared';
import type { AuthUser } from './context';
import { forbidden } from './errors';
import type { Prisma } from '../generated/prisma/client';

export const can = (user: AuthUser, permission: Permission) => user.permissions.has(permission);

export function assertCan(user: AuthUser, permission: Permission) {
  if (!can(user, permission)) throw forbidden();
}

/** Letters a user is directly involved in, regardless of register-wide read rights. */
function involvement(userId: string): Prisma.IncomingLetterWhereInput[] {
  return [
    { createdById: userId },
    { forwardedToId: userId },
    { dispositions: { some: { issuerId: userId } } },
    { dispositions: { some: { assignments: { some: { assigneeId: userId } } } } },
  ];
}

/**
 * Object-level read scope for incoming letters.
 * - letter.read_all: every non-confidential letter in the register
 * - letter.read_all + letter.read_confidential: every letter
 * - otherwise: only letters the user is involved in (creator, forwarded-to, issuer, assignee)
 */
export function letterReadScope(user: AuthUser): Prisma.IncomingLetterWhereInput {
  if (can(user, 'letter.read_all') && can(user, 'letter.read_confidential')) return { deletedAt: null };
  const ors: Prisma.IncomingLetterWhereInput[] = involvement(user.id);
  if (can(user, 'letter.read_all')) ors.push({ confidentiality: { not: 'RAHASIA' } });
  return { deletedAt: null, OR: ors };
}

export function outgoingReadScope(user: AuthUser): Prisma.OutgoingLetterWhereInput {
  if (can(user, 'outgoing.read_all') && can(user, 'letter.read_confidential')) return { deletedAt: null };
  const ors: Prisma.OutgoingLetterWhereInput[] = [{ createdById: user.id }, { reviewedById: user.id }];
  if (can(user, 'outgoing.read_all')) ors.push({ confidentiality: { not: 'RAHASIA' } });
  return { deletedAt: null, OR: ors };
}
