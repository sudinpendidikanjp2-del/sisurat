import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

/**
 * Private document storage. Callers keep only the storage key; files are never served publicly.
 * Implement this interface for S3-compatible private buckets if needed.
 */
export interface DocumentStorage {
  put(data: Buffer, extension: string): Promise<string>;
  read(storageKey: string): Promise<Buffer>;
  stream(storageKey: string): Readable;
  exists(storageKey: string): Promise<boolean>;
  remove(storageKey: string): Promise<void>;
}

const KEY_PATTERN = /^\d{4}\/\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;

export class LocalPrivateStorage implements DocumentStorage {
  constructor(private readonly baseDir: string) {}

  private resolve(storageKey: string): string {
    if (!KEY_PATTERN.test(storageKey)) throw new Error('Storage key tidak valid');
    const full = path.resolve(this.baseDir, storageKey);
    if (!full.startsWith(path.resolve(this.baseDir) + path.sep)) throw new Error('Storage key tidak valid');
    return full;
  }

  async put(data: Buffer, extension: string): Promise<string> {
    const ext = extension.replace(/^\./, '').toLowerCase();
    if (!/^[a-z0-9]{2,5}$/.test(ext)) throw new Error('Ekstensi tidak valid');
    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ext}`;
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    // wx: never overwrite an existing source document
    await writeFile(full, data, { mode: 0o600, flag: 'wx' });
    return key;
  }

  read(storageKey: string): Promise<Buffer> {
    return readFile(this.resolve(storageKey));
  }

  stream(storageKey: string): Readable {
    return createReadStream(this.resolve(storageKey));
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await stat(this.resolve(storageKey));
      return true;
    } catch {
      return false;
    }
  }

  async remove(storageKey: string): Promise<void> {
    await rm(this.resolve(storageKey), { force: true });
  }
}
