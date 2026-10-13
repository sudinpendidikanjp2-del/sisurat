import { env } from './config/env';
import { prisma } from './db';
import { LocalPrivateStorage } from './storage/storage';
import { createDocumentAIService } from './ai/factory';
import { runWorker } from './jobs/worker';

const controller = new AbortController();
process.on('SIGINT', () => controller.abort());
process.on('SIGTERM', () => controller.abort());

const log = (msg: string, extra?: Record<string, unknown>) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), component: 'worker', msg, ...extra }));

await runWorker(
  { prisma, storage: new LocalPrivateStorage(env.DOCUMENT_STORAGE_PATH), ai: createDocumentAIService() },
  { pollMs: env.WORKER_POLL_MS, log, signal: controller.signal },
);
await prisma.$disconnect();
