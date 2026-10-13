import PizZip from 'pizzip';
import { getDocumentProxy } from 'unpdf';
import { badRequest } from '../lib/errors';

export type AllowedKind = 'pdf' | 'png' | 'jpeg' | 'docx';

export const MIME_BY_KIND: Record<AllowedKind, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpeg: 'image/jpeg',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const EXT_BY_KIND: Record<AllowedKind, string[]> = {
  pdf: ['pdf'],
  png: ['png'],
  jpeg: ['jpg', 'jpeg'],
  docx: ['docx'],
};

/** Identify a file by its magic bytes — the client-supplied MIME type is never trusted. */
export function detectKind(buf: Buffer): AllowedKind | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 4 && buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    try {
      const zip = new PizZip(buf);
      if (zip.file('word/document.xml')) return 'docx';
    } catch {
      return null;
    }
  }
  return null;
}

/** Strip path components and unsafe characters from a client filename (used for display only). */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'berkas';
  const cleaned = base.replace(/[^\p{L}\p{N}._ ()-]/gu, '_').replace(/\.{2,}/g, '.').trim();
  return (cleaned || 'berkas').slice(0, 150);
}

export interface ValidatedFile {
  kind: AllowedKind;
  mimeType: string;
  extension: string;
  pageCount: number | null;
  originalName: string;
}

export async function validateUpload(
  buf: Buffer,
  filename: string,
  opts: { allowed: AllowedKind[]; maxBytes: number; maxPdfPages?: number },
): Promise<ValidatedFile> {
  if (buf.length === 0) throw badRequest(`Berkas "${filename}" kosong`);
  if (buf.length > opts.maxBytes) {
    throw badRequest(`Berkas "${filename}" melebihi batas ${Math.round(opts.maxBytes / 1024 / 1024)} MB`);
  }
  const kind = detectKind(buf);
  if (!kind || !opts.allowed.includes(kind)) {
    throw badRequest(`Jenis berkas "${filename}" tidak didukung. Gunakan: ${opts.allowed.join(', ').toUpperCase()}`);
  }
  const originalName = sanitizeFilename(filename);
  const ext = originalName.includes('.') ? originalName.split('.').pop()!.toLowerCase() : '';
  if (!EXT_BY_KIND[kind].includes(ext)) {
    throw badRequest(`Ekstensi berkas "${filename}" tidak sesuai dengan isinya`);
  }
  let pageCount: number | null = null;
  if (kind === 'pdf') {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      pageCount = pdf.numPages;
      await pdf.loadingTask.destroy();
    } catch {
      throw badRequest(`PDF "${filename}" rusak, terenkripsi, atau tidak dapat dibaca`);
    }
    if (opts.maxPdfPages && pageCount > opts.maxPdfPages) {
      throw badRequest(`PDF "${filename}" memiliki ${pageCount} halaman (batas ${opts.maxPdfPages})`);
    }
  } else if (kind === 'png' || kind === 'jpeg') {
    pageCount = 1;
  }
  return { kind, mimeType: MIME_BY_KIND[kind], extension: EXT_BY_KIND[kind][0], pageCount, originalName };
}
