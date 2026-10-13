import { z } from 'zod';
import {
  LETTER_TYPES,
  REQUIRED_REVIEW_FIELDS,
  type Evidence,
  type NormalizedFields,
  type ReviewFlag,
} from '@sisurat/shared';
import { parseFlexibleDate } from './dateParse';
import { ProviderError } from './types';

const PLACEHOLDER_VALUES = new Set(['', '-', '--', 'null', 'none', 'n/a', 'na', 'unknown', 'tidak ada', 'tidak diketahui', 'tidak ditemukan']);

function clean(v: unknown, max = 1000): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (PLACEHOLDER_VALUES.has(s.toLowerCase())) return null;
  return s.slice(0, max);
}

const looseOutput = z
  .object({
    evidence: z.array(z.unknown()).optional().default([]),
    uncertain_fields: z.array(z.unknown()).optional().default([]),
  })
  .passthrough();

/**
 * Converts raw provider output into NormalizedFields + review flags. Rejects outputs that are
 * not a JSON object (retryable INVALID_RESPONSE). Missing/invalid values become null + flag.
 */
export function normalizeOutput(raw: unknown): {
  normalized: NormalizedFields;
  reviewFlags: ReviewFlag[];
  evidence: Evidence[];
} {
  const parsed = looseOutput.safeParse(raw);
  if (!parsed.success || typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ProviderError('INVALID_RESPONSE', 'Keluaran provider bukan objek JSON yang valid');
  }
  const o = parsed.data as Record<string, unknown>;
  const flags: ReviewFlag[] = [];

  const letterDateRaw = clean(o.letter_date_raw) ?? clean(o.letter_date);
  const eventDateRaw = clean(o.event_date_raw) ?? clean(o.event_date);
  const letterDate = parseFlexibleDate(clean(o.letter_date)) ?? parseFlexibleDate(letterDateRaw);
  const eventDate = parseFlexibleDate(clean(o.event_date)) ?? parseFlexibleDate(eventDateRaw);

  let documentType = clean(o.document_type, 50)?.toUpperCase().replace(/\s+/g, '_') ?? null;
  if (documentType && !(LETTER_TYPES as readonly string[]).includes(documentType)) {
    flags.push({ field: 'document_type', code: 'INVALID_FORMAT', message: `Jenis "${documentType}" tidak dikenal` });
    documentType = null;
  }

  const normalized: NormalizedFields = {
    document_type: documentType,
    letter_number: clean(o.letter_number, 150),
    letter_date: letterDate,
    letter_date_raw: letterDateRaw,
    sender_name: clean(o.sender_name, 250),
    recipient_name: clean(o.recipient_name, 250),
    subject: clean(o.subject, 500),
    attachment_text: clean(o.attachment_text, 250),
    event_date: eventDate,
    event_date_raw: eventDateRaw,
    event_location: clean(o.event_location, 250),
    summary: clean(o.summary, 4000),
    suggested_category: clean(o.suggested_category, 100),
  };

  if (letterDateRaw && !letterDate) {
    flags.push({ field: 'letter_date', code: 'INVALID_FORMAT', message: `Tanggal "${letterDateRaw}" tidak dapat dibaca` });
  }
  if (eventDateRaw && !eventDate) {
    flags.push({ field: 'event_date', code: 'INVALID_FORMAT', message: `Tanggal "${eventDateRaw}" tidak dapat dibaca` });
  }
  for (const field of REQUIRED_REVIEW_FIELDS) {
    if (normalized[field] === null && !flags.some((f) => f.field === field)) {
      flags.push({ field, code: 'MISSING', message: 'Tidak ditemukan pada dokumen' });
    }
  }
  for (const u of o.uncertain_fields as unknown[]) {
    if (u && typeof u === 'object' && 'field' in u) {
      const field = clean((u as { field: unknown }).field, 50);
      const reason = clean((u as { reason?: unknown }).reason, 300) ?? undefined;
      if (field && !flags.some((f) => f.field === field && f.code === 'AMBIGUOUS')) {
        flags.push({ field, code: 'AMBIGUOUS', message: reason });
      }
    }
  }

  const evidence: Evidence[] = [];
  for (const e of o.evidence as unknown[]) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    const field = clean(r.field, 50);
    if (!field) continue;
    const page = typeof r.page === 'number' && Number.isInteger(r.page) && r.page > 0 ? r.page : null;
    evidence.push({ field, page, quote: clean(r.quote, 300) });
    if (evidence.length >= 30) break;
  }
  return { normalized, reviewFlags: flags, evidence };
}

/** Adds CONFLICT flags where two independent readings disagree on a key field. */
export function compareReadings(primary: NormalizedFields, secondary: Partial<NormalizedFields>): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  for (const field of ['letter_number', 'letter_date'] as const) {
    const a = primary[field];
    const b = secondary[field];
    if (a && b && a.replace(/\s+/g, '').toLowerCase() !== b.replace(/\s+/g, '').toLowerCase()) {
      flags.push({ field, code: 'CONFLICT', message: `Teks dokumen menunjukkan "${b}", hasil AI "${a}"` });
    }
  }
  return flags;
}
