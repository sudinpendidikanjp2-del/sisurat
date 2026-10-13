import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db';
import { LocalPrivateStorage } from '../../src/storage/storage';
import { DocumentAIService } from '../../src/ai/documentAiService';
import type { OcrEngine, ProviderRequest, ProviderResponse, StructuredExtractionProvider } from '../../src/ai/types';
import { ProviderError } from '../../src/ai/types';
import { seedBase, seedDemo } from '../../src/seed/seed';
import { drainQueue } from '../../src/jobs/extraction';
import type { Deps } from '../../src/lib/deps';
import type { Prisma } from '../../src/generated/prisma/client';

export const DEMO_PASSWORD = 'DemoPass123';
export const ADMIN_PASSWORD = 'AdminPass123';

type Behaviour = ProviderResponse | ProviderError | ((req: ProviderRequest) => ProviderResponse | Promise<ProviderResponse>);

/** Scriptable provider: each call consumes the next behaviour (the last one repeats). */
export class MockProvider implements StructuredExtractionProvider {
  calls: ProviderRequest[] = [];
  private queue: Behaviour[] = [];
  constructor(public readonly id: 'GEMINI' | 'CLAUDE', private configured = true) {}
  isConfigured() {
    return this.configured;
  }
  supports() {
    return true;
  }
  script(...b: Behaviour[]) {
    this.queue = b;
    return this;
  }
  async extract(req: ProviderRequest): Promise<ProviderResponse> {
    this.calls.push(req);
    const b = this.queue.length > 1 ? this.queue.shift()! : this.queue[0];
    if (!b) throw new ProviderError('UNAVAILABLE', 'no script');
    if (b instanceof ProviderError) throw b;
    return typeof b === 'function' ? b(req) : b;
  }
}

export class MockOcr implements OcrEngine {
  calls = 0;
  constructor(public text = '') {}
  async isAvailable() {
    return true;
  }
  async recognize() {
    this.calls++;
    return { text: this.text, pages: 1 };
  }
}

export interface TestContext {
  app: FastifyInstance;
  deps: Deps;
  gemini: MockProvider;
  claude: MockProvider;
  ocr: MockOcr | null;
  drain: () => Promise<number>;
}

export async function resetDatabase() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
}

export async function createTestContext(opts: { ocr?: MockOcr | null } = {}): Promise<TestContext> {
  await resetDatabase();
  const dir = await mkdtemp(path.join(tmpdir(), 'sisurat-test-'));
  const storage = new LocalPrivateStorage(dir);
  const gemini = new MockProvider('GEMINI');
  const claude = new MockProvider('CLAUDE');
  const ocr = opts.ocr === undefined ? null : opts.ocr;
  const ai = new DocumentAIService({ GEMINI: gemini, CLAUDE: claude }, ocr);
  const deps: Deps = { prisma, storage, ai };
  const silent = () => undefined;
  await seedBase(prisma, { adminPassword: ADMIN_PASSWORD, log: silent });
  await seedDemo(prisma, storage, { password: DEMO_PASSWORD, log: silent });
  await prisma.user.update({ where: { username: 'admin' }, data: { mustChangePassword: false } });
  const app = await buildApp(deps, { logger: false });
  return { app, deps, gemini, claude, ocr, drain: () => drainQueue(deps) };
}

/** Enables + approves an external provider for the given confidentiality levels. */
export async function approveProvider(provider: 'GEMINI' | 'CLAUDE', levels: ('BIASA' | 'TERBATAS' | 'RAHASIA')[] = ['BIASA']) {
  await prisma.aiProviderConfig.update({
    where: { provider },
    data: { enabled: true, approvedForExternal: true, allowedConfidentiality: levels, inputCostPerMTokUsd: 1, outputCostPerMTokUsd: 2 },
  });
  const row = await prisma.appSetting.findUniqueOrThrow({ where: { key: 'app' } });
  await prisma.appSetting.update({
    where: { key: 'app' },
    data: { value: { ...(row.value as Prisma.JsonObject), aiEnabled: true, primaryProvider: provider } },
  });
}

export async function updateSettings(patch: Record<string, unknown>) {
  const row = await prisma.appSetting.findUniqueOrThrow({ where: { key: 'app' } });
  await prisma.appSetting.update({ where: { key: 'app' }, data: { value: { ...(row.value as Prisma.JsonObject), ...patch } as Prisma.InputJsonObject } });
}

export interface Session {
  cookie: string;
  csrf: string;
  userId: string;
}

export async function login(app: FastifyInstance, username: string, password = username === 'admin' ? ADMIN_PASSWORD : DEMO_PASSWORD): Promise<Session> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
  if (res.statusCode !== 200) throw new Error(`login ${username} failed: ${res.body}`);
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie!;
  return { cookie: raw.split(';')[0], csrf: res.json().csrfToken, userId: res.json().user.id };
}

export interface FileInput {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export function multipart(fields: Record<string, string>, files: FileInput[], fileField = 'files') {
  const boundary = `----sisurat${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const f of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${f.filename}"\r\nContent-Type: ${f.contentType ?? 'application/octet-stream'}\r\n\r\n`,
      ),
      f.content,
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

/** Thin request helper bound to a session. */
export function client(app: FastifyInstance, s: Session | null) {
  const headers = (extra: Record<string, string> = {}) => ({
    ...(s ? { cookie: s.cookie, 'x-csrf-token': s.csrf } : {}),
    ...extra,
  });
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown, extra?: Record<string, string>): Promise<LightMyRequestResponse> =>
    app.inject({ method, url, headers: headers(extra), ...(payload !== undefined && { payload: payload as object }) });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload?: unknown, extra?: Record<string, string>) => call('POST', url, payload ?? {}, extra),
    patch: (url: string, payload: unknown) => call('PATCH', url, payload),
    put: (url: string, payload: unknown) => call('PUT', url, payload),
    upload: (url: string, fields: Record<string, string>, files: FileInput[], extra: Record<string, string> = {}, fileField = 'files') => {
      const mp = multipart(fields, files, fileField);
      return app.inject({ method: 'POST', url, headers: { ...headers(extra), ...mp.headers }, payload: mp.payload });
    },
  };
}

/** Registers a letter manually (no file) and verifies it. Returns the letter id. */
export async function registerManualLetter(
  app: FastifyInstance,
  tu: Session,
  overrides: Record<string, unknown> = {},
) {
  const api = client(app, tu);
  const meta = {
    subject: 'Permohonan data kepegawaian',
    letterNumber: `100/${Math.floor(Math.random() * 1e6)}/2026`,
    letterDate: '2026-10-01',
    receivedDate: '2026-10-02',
    senderName: 'Badan Contoh',
    recipientName: 'Kepala Kantor',
    ...overrides,
  };
  const created = await api.upload('/api/incoming-letters', { metadata: JSON.stringify(meta) }, []);
  if (created.statusCode !== 201) throw new Error(created.body);
  const id = created.json().id as string;
  const verified = await api.post(`/api/incoming-letters/${id}/verify`, meta);
  if (verified.statusCode !== 200) throw new Error(verified.body);
  return id;
}
