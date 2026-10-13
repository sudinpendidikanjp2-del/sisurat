const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export function toRomanMonth(month: number): string {
  return ROMAN[month - 1] ?? String(month);
}

/**
 * Render a configurable number format. Tokens:
 * {seq} / {seq:N} (zero padded), {yyyy}, {yy}, {mm}, {roman_month}, {code}.
 */
export function renderNumberFormat(
  format: string,
  params: { seq: number; date: Date; code?: string },
): string {
  const { seq, date, code } = params;
  const month = date.getMonth() + 1;
  return format
    .replace(/\{seq(?::(\d+))?\}/g, (_m, pad?: string) => String(seq).padStart(pad ? Number(pad) : 0, '0'))
    .replace(/\{yyyy\}/g, String(date.getFullYear()))
    .replace(/\{yy\}/g, String(date.getFullYear()).slice(-2))
    .replace(/\{mm\}/g, String(month).padStart(2, '0'))
    .replace(/\{roman_month\}/g, toRomanMonth(month))
    .replace(/\{code\}/g, code ?? '');
}

/** Format an ISO date (YYYY-MM-DD or full ISO) as Indonesian long date. */
export function formatDateId(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
