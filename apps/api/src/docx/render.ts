import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import type { PlaceholderDef } from '@sisurat/shared';
import { badRequest } from '../lib/errors';

/** Filled automatically by the system; never typed by the user. */
export const SYSTEM_PLACEHOLDERS = ['nomor', 'nama_instansi'] as const;
export const PENDING_NUMBER_TEXT = '[nomor diberikan saat finalisasi]';

function load(buffer: Buffer) {
  try {
    const zip = new PizZip(buffer);
    return new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
  } catch {
    throw badRequest('Templat DOCX tidak valid atau memiliki tag placeholder yang rusak');
  }
}

/** Lists {placeholder} tags in a template (docxtemplater merges runs split by Word). */
export function detectPlaceholders(buffer: Buffer): string[] {
  const text = load(buffer).getFullText();
  const keys = new Set<string>();
  for (const m of text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) keys.add(m[1]);
  return [...keys];
}

export function humanize(key: string) {
  const s = key.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function defaultPlaceholderDefs(keys: string[]): PlaceholderDef[] {
  return keys
    .filter((k) => !(SYSTEM_PLACEHOLDERS as readonly string[]).includes(k))
    .map((key) => ({ key, label: humanize(key), required: true, multiline: /isi|agenda|daftar|keterangan|maksud/.test(key) }));
}

/** Returns the list of required user placeholders that are empty. */
export function missingRequired(defs: PlaceholderDef[], data: Record<string, string>) {
  return defs.filter((d) => d.required && !(data[d.key] ?? '').trim()).map((d) => d.label);
}

export function renderDocx(template: Buffer, data: Record<string, string>): Buffer {
  const doc = load(template);
  try {
    doc.render(data);
  } catch {
    throw badRequest('Gagal mengisi templat DOCX; periksa tag placeholder pada templat');
  }
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}
