import type { DbOrTx } from '../db';
import type { ActionContext, SystemContext } from './context';
import type { Prisma } from '../generated/prisma/client';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/** Fields whose values must never be written to the audit log. */
const REDACT = new Set(['passwordHash', 'password', 'newPassword', 'currentPassword', 'token', 'csrfToken', 'rawOutput']);
/** Long free-text fields are truncated so letter content is not copied wholesale into logs. */
const MAX_STRING = 300;

function sanitize(obj: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | undefined {
  if (!obj) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT.has(k)) {
      out[k] = '[REDACTED]';
    } else if (v instanceof Date) {
      out[k] = v.toISOString();
    } else if (typeof v === 'string' && v.length > MAX_STRING) {
      out[k] = `${v.slice(0, MAX_STRING)}… (${v.length} karakter)`;
    } else if (v === undefined) {
      continue;
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitize(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out as Prisma.InputJsonValue;
}

export async function audit(db: DbOrTx, ctx: ActionContext | SystemContext, entry: AuditEntry) {
  await db.auditLog.create({
    data: {
      actorId: ctx.user?.id ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary ?? ('system' in ctx ? `[${ctx.system}]` : undefined),
      before: sanitize(entry.before),
      after: sanitize(entry.after),
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent?.slice(0, 300) ?? null,
    },
  });
}

/** Returns only keys whose values differ, as {before, after} maps. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const nv = normalizeForCompare(after[key]);
    const ov = normalizeForCompare(before[key]);
    if (nv !== ov) {
      b[key] = before[key] ?? null;
      a[key] = after[key] ?? null;
    }
  }
  return { before: b, after: a, changed: Object.keys(a) };
}

export function normalizeForCompare(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && v !== null && 'toString' in v && !(Array.isArray(v))) return String(v);
  return String(v);
}
