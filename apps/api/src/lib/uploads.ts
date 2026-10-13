import type { FastifyRequest } from 'fastify';
import { AppError, badRequest } from './errors';

export interface UploadedFile {
  filename: string;
  buffer: Buffer;
}

/**
 * Reads a multipart request into memory (files are small: limits enforced by @fastify/multipart
 * and validateUpload). Returns form fields and files.
 */
export async function readMultipart(req: FastifyRequest, opts: { maxFiles: number; maxBytes: number }) {
  if (!req.isMultipart()) throw badRequest('Permintaan harus berupa multipart/form-data');
  const fields: Record<string, string> = {};
  const files: UploadedFile[] = [];
  for await (const part of req.parts({ limits: { fileSize: opts.maxBytes, files: opts.maxFiles, fields: 20 } })) {
    if (part.type === 'file') {
      let buffer: Buffer;
      try {
        buffer = await part.toBuffer();
      } catch (err) {
        if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
          throw new AppError(413, 'PAYLOAD_TOO_LARGE', `Berkas "${part.filename}" melebihi batas ${Math.round(opts.maxBytes / 1024 / 1024)} MB`);
        }
        throw err;
      }
      if (part.file.truncated) {
        throw badRequest(`Berkas "${part.filename}" melebihi batas ${Math.round(opts.maxBytes / 1024 / 1024)} MB`);
      }
      files.push({ filename: part.filename, buffer });
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }
  return { fields, files };
}

export function parseJsonField(fields: Record<string, string>, name: string): unknown {
  if (!fields[name]) return {};
  try {
    return JSON.parse(fields[name]);
  } catch {
    throw badRequest(`Field "${name}" bukan JSON yang valid`);
  }
}
