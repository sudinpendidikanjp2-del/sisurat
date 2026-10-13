import { extractText, getDocumentProxy } from 'unpdf';

export interface PdfText {
  pages: string[];
  totalChars: number;
  pageCount: number;
}

/** Extracts the embedded text layer of a PDF locally (no network). */
export async function extractPdfText(buffer: Buffer): Promise<PdfText> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  try {
    const { text, totalPages } = await extractText(pdf, { mergePages: false });
    const pages = (Array.isArray(text) ? text : [text]).map((t) => t ?? '');
    const totalChars = pages.reduce((n, p) => n + p.replace(/\s+/g, '').length, 0);
    return { pages, totalChars, pageCount: totalPages };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** A PDF counts as "digital" when it carries enough text per page; otherwise it is treated as a scan. */
export function isTextSufficient(t: PdfText, minCharsPerPage: number): boolean {
  if (t.pageCount === 0) return false;
  return t.totalChars / t.pageCount >= minCharsPerPage;
}
