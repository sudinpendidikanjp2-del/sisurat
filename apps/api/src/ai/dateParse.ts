const MONTHS: Record<string, number> = {
  januari: 1, january: 1, jan: 1,
  februari: 2, february: 2, feb: 2, pebruari: 2,
  maret: 3, march: 3, mar: 3,
  april: 4, apr: 4,
  mei: 5, may: 5,
  juni: 6, june: 6, jun: 6,
  juli: 7, july: 7, jul: 7,
  agustus: 8, august: 8, agu: 8, aug: 8, agt: 8,
  september: 9, sep: 9, sept: 9,
  oktober: 10, october: 10, okt: 10, oct: 10,
  november: 11, nov: 11, nopember: 11,
  desember: 12, december: 12, des: 12, dec: 12,
};

export const MONTH_PATTERN =
  '(Januari|Februari|Pebruari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Nopember|Desember|Jan|Feb|Mar|Apr|Jun|Jul|Agu|Agt|Sep|Sept|Okt|Nov|Des)';

function valid(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * Parse common Indonesian/ISO date notations into YYYY-MM-DD. Returns null when unsure —
 * never guesses a missing year or month.
 */
export function parseFlexibleDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month) return valid(+m[3], month, +m[1]);
  }
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return valid(+m[3], +m[2], +m[1]); // Indonesian convention: day first
  return null;
}
