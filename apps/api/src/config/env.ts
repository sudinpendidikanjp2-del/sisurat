import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';
import { DEFAULT_DATABASE_URL } from './defaults';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? def : v === 'true' || v === '1'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().default(DEFAULT_DATABASE_URL),
  /** Origin of the web app, used for CORS-free same-site checks and links. */
  APP_ORIGIN: z.string().default('http://localhost:5173'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(12),
  COOKIE_SECURE: bool(false),
  TRUST_PROXY: bool(false),
  DOCUMENT_STORAGE_PATH: z.string().default(path.resolve(process.cwd(), 'storage')),
  LOG_LEVEL: z.string().default('info'),

  // AI providers — keys live only here, never in the database or responses.
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  CLAUDE_API_KEY: z.string().optional(),
  CLAUDE_MODEL: z.string().default('claude-opus-5-5'),
  /** Initial primary provider written on first seed; admins change it in the UI afterwards. */
  AI_PROVIDER: z.enum(['GEMINI', 'CLAUDE', 'TESSERACT']).default('GEMINI'),
  TESSERACT_PATH: z.string().default('tesseract'),
  TESSERACT_LANG: z.string().default('ind+eng'),
  PDFTOPPM_PATH: z.string().default('pdftoppm'),

  // Worker
  WORKER_POLL_MS: z.coerce.number().int().min(200).default(2000),
  WORKER_INLINE: bool(false),

  // Seed
  SEED_ADMIN_PASSWORD: z.string().optional(),
  SEED_DEMO_DATA: bool(true),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Konfigurasi environment tidak valid: ${parsed.error.message}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    if (!source.DATABASE_URL) throw new Error('DATABASE_URL wajib diisi di production');
    if (!env.COOKIE_SECURE) throw new Error('COOKIE_SECURE=true wajib di production (HTTPS)');
  }
  return env;
}

export const env = loadEnv();
