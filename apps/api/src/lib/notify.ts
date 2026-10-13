import type { NotificationType } from '@sisurat/shared';
import type { DbOrTx } from '../db';

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  link?: string;
  /** When set, a second notification with the same key is silently skipped. */
  dedupeKey?: string;
}

export async function notify(db: DbOrTx, items: NotificationInput | NotificationInput[]) {
  const list = Array.isArray(items) ? items : [items];
  if (list.length === 0) return 0;
  const res = await db.notification.createMany({ data: list, skipDuplicates: true });
  return res.count;
}
