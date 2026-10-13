import { MONTH_PATTERN } from './dateParse';

/**
 * Rule-based reader for Indonesian official letters ("Nomor :", "Perihal :", "Yth.", etc.).
 * Used for digital PDFs (no AI call) and Tesseract OCR output. Returns the same raw shape as the
 * AI schema so it goes through the same normalisation and review flags.
 * It only copies text that is present; anything it cannot find stays null.
 */
export interface HeuristicOutput {
  document_type: string | null;
  letter_number: string | null;
  letter_date: string | null;
  letter_date_raw: string | null;
  sender_name: string | null;
  recipient_name: string | null;
  subject: string | null;
  attachment_text: string | null;
  event_date: string | null;
  event_date_raw: string | null;
  event_location: string | null;
  summary: string | null;
  suggested_category: string | null;
  evidence: { field: string; page: number | null; quote: string | null }[];
  uncertain_fields: { field: string; reason: string }[];
}

const DATE_RE = new RegExp(`(\\d{1,2})\\s+${MONTH_PATTERN}\\s+(\\d{4})`, 'i');

function labelValue(lines: string[], labels: string[]): { value: string; line: string; index: number } | null {
  const re = new RegExp(`^\\s*(?:${labels.join('|')})\\s*\\.?\\s*[:：]\\s*(.+)$`, 'i');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (m && m[1].trim()) return { value: m[1].trim(), line: lines[i].trim(), index: i };
  }
  return null;
}

function pageOf(pages: string[], needle: string): number | null {
  const idx = pages.findIndex((p) => p.includes(needle));
  return idx >= 0 ? idx + 1 : null;
}

function guessType(subject: string | null, body: string): string | null {
  const s = `${subject ?? ''} ${body.slice(0, 400)}`.toLowerCase();
  if (/undangan|mengundang/.test(s)) return 'UNDANGAN';
  if (/surat tugas|menugaskan/.test(s)) return 'TUGAS';
  if (/permohonan|mohon/.test(s)) return 'PERMOHONAN';
  if (/edaran/.test(s)) return 'EDARAN';
  if (/pemberitahuan|memberitahukan/.test(s)) return 'PEMBERITAHUAN';
  if (/nota dinas/.test(s)) return 'NOTA_DINAS';
  if (/keterangan/.test(s)) return 'KETERANGAN';
  if (/pengantar/.test(s)) return 'PENGANTAR';
  if (/laporan/.test(s)) return 'LAPORAN';
  return null;
}

export function parseLetterText(pages: string[]): HeuristicOutput {
  const full = pages.join('\n');
  const lines = full
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const evidence: HeuristicOutput['evidence'] = [];
  const uncertain: HeuristicOutput['uncertain_fields'] = [];
  const ev = (field: string, quote: string) => evidence.push({ field, page: pageOf(pages, quote.slice(0, 20)), quote: quote.slice(0, 200) });

  const number = labelValue(lines, ['Nomor', 'No']);
  if (number) ev('letter_number', number.line);
  const attachment = labelValue(lines, ['Lampiran', 'Lamp']);
  if (attachment) ev('attachment_text', attachment.line);
  const subject = labelValue(lines, ['Perihal', 'Hal']);
  if (subject) ev('subject', subject.line);

  // Letter date: "Kota, 12 Oktober 2026" near the top, else the first full date in the first 25 lines.
  let letterDateRaw: string | null = null;
  const head = lines.slice(0, 25);
  const placeDate = head.find((l) => /^[A-Za-z .'-]{2,40},\s*\d{1,2}\s+\S+\s+\d{4}$/.test(l) && DATE_RE.test(l));
  const firstDate = placeDate ?? head.find((l) => DATE_RE.test(l) && !/hari|tanggal\s*:/i.test(l));
  if (firstDate) {
    letterDateRaw = firstDate.match(DATE_RE)![0];
    ev('letter_date', firstDate);
    if (!placeDate) uncertain.push({ field: 'letter_date', reason: 'Tanggal diambil dari tanggal pertama di kepala surat' });
  }

  // Recipient: line after "Yth." / "Kepada Yth."
  let recipient: string | null = null;
  const ythIdx = lines.findIndex((l) => /\bYth\.?/i.test(l));
  if (ythIdx >= 0) {
    const after = lines[ythIdx].replace(/^.*?\bYth\.?\s*/i, '').trim();
    recipient = after || lines[ythIdx + 1] || null;
    if (recipient) ev('recipient_name', `Yth. ${recipient}`);
  }

  // Sender: uppercase letterhead lines before the first labelled field.
  const stop = Math.min(number?.index ?? 10, 10);
  const headLines = lines.slice(0, stop).filter((l) => l.length > 3 && l === l.toUpperCase() && /[A-Z]/.test(l) && !/^(JALAN|JL\.|TELP|TELEPON|FAX|EMAIL|WEBSITE|KODE POS)/.test(l) && !/@|www\./i.test(l));
  let sender: string | null = null;
  if (headLines.length) {
    // The most specific agency is usually the last uppercase heading line (e.g. "DINAS PENDIDIKAN").
    sender = headLines.slice(0, 3).join(' ');
    ev('sender_name', headLines[0]);
    uncertain.push({ field: 'sender_name', reason: 'Diperkirakan dari kop surat; mohon diperiksa' });
  }

  // Event details ("Hari/Tanggal : ...", "Tempat : ...")
  const eventLine = labelValue(lines, ['Hari\\s*/\\s*Tanggal', 'Hari,\\s*Tanggal', 'Tanggal']);
  const eventDateRaw = eventLine?.value.match(DATE_RE)?.[0] ?? null;
  if (eventLine && eventDateRaw) ev('event_date', eventLine.line);
  const place = labelValue(lines, ['Tempat', 'Lokasi']);
  if (place) ev('event_location', place.line);

  // Summary: first sentence(s) after the salutation, copied verbatim (extractive, not generated).
  let summary: string | null = null;
  const bodyStart = lines.findIndex((l) => /^dengan hormat/i.test(l));
  if (bodyStart >= 0) {
    const bodyLines: string[] = [];
    for (const l of lines.slice(bodyStart + 1, bodyStart + 8)) {
      if (/^[A-Za-z/ ,]{2,25}\s*[:：]/.test(l)) break; // stop at "Hari/Tanggal :", "Tempat :" …
      bodyLines.push(l);
    }
    const sentences = bodyLines.join(' ').split(/(?<=\.)\s+(?=[A-Z])/);
    summary = sentences.slice(0, 2).join(' ').trim().slice(0, 600) || null;
  }

  return {
    document_type: guessType(subject?.value ?? null, full),
    letter_number: number?.value ?? null,
    letter_date: null,
    letter_date_raw: letterDateRaw,
    sender_name: sender,
    recipient_name: recipient,
    subject: subject?.value ?? null,
    attachment_text: attachment?.value ?? null,
    event_date: null,
    event_date_raw: eventDateRaw,
    event_location: place?.value ?? null,
    summary,
    suggested_category: null,
    evidence,
    uncertain_fields: uncertain,
  };
}

/** True when the rule-based reading found the fields that make an AI call unnecessary. */
export function heuristicIsSufficient(h: HeuristicOutput): boolean {
  return Boolean(h.letter_number && h.letter_date_raw && h.subject);
}
