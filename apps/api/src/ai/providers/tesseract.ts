import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { ProviderError, type OcrEngine } from '../types';

const run = promisify(execFile);

/**
 * Local OCR via the `tesseract` CLI (and `pdftoppm` to rasterise scanned PDFs).
 * Nothing leaves the server. Disabled automatically when the binaries are not installed.
 */
export class TesseractOcr implements OcrEngine {
  private available: boolean | null = null;

  constructor(
    private readonly tesseractPath: string,
    private readonly pdftoppmPath: string,
    private readonly lang: string,
  ) {}

  async isAvailable(): Promise<boolean> {
    if (this.available === null) {
      try {
        await run(this.tesseractPath, ['--version'], { timeout: 5000 });
        this.available = true;
      } catch {
        this.available = false;
      }
    }
    return this.available;
  }

  async recognize(file: { buffer: Buffer; mimeType: string }, timeoutMs: number) {
    if (!(await this.isAvailable())) throw new ProviderError('NOT_CONFIGURED', 'Tesseract tidak terpasang di server');
    const dir = await mkdtemp(path.join(tmpdir(), 'sisurat-ocr-'));
    try {
      let images: string[];
      if (file.mimeType === 'application/pdf') {
        const pdfPath = path.join(dir, 'input.pdf');
        await writeFile(pdfPath, file.buffer, { mode: 0o600 });
        await run(this.pdftoppmPath, ['-r', '300', '-png', pdfPath, path.join(dir, 'page')], { timeout: timeoutMs });
        images = (await readdir(dir)).filter((f) => f.startsWith('page') && f.endsWith('.png')).sort();
      } else {
        const ext = file.mimeType === 'image/png' ? 'png' : 'jpg';
        await writeFile(path.join(dir, `page-1.${ext}`), file.buffer, { mode: 0o600 });
        images = [`page-1.${ext}`];
      }
      const pages: string[] = [];
      for (const img of images) {
        const base = path.join(dir, `${img}.out`);
        await run(this.tesseractPath, [path.join(dir, img), base, '-l', this.lang], { timeout: timeoutMs });
        pages.push(await readFile(`${base}.txt`, 'utf8'));
      }
      return { text: pages.join('\n\f\n'), pages: pages.length };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      const killed = (err as { killed?: boolean }).killed;
      throw new ProviderError(killed ? 'TIMEOUT' : 'OCR_FAILED', killed ? 'OCR melebihi batas waktu' : 'OCR lokal gagal');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
