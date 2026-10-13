import { env } from './config/env';
import { buildApp } from './app';
import { prisma } from './db';
import { LocalPrivateStorage } from './storage/storage';
import { createDocumentAIService } from './ai/factory';
import { drainQueue } from './jobs/extraction';

const storage = new LocalPrivateStorage(env.DOCUMENT_STORAGE_PATH);
const ai = createDocumentAIService();

let draining = false;
/** WORKER_INLINE=true processes jobs inside the API process (single-process dev setups). */
const onJobEnqueued = env.WORKER_INLINE
  ? () => {
      if (draining) return;
      draining = true;
      setImmediate(() => {
        drainQueue({ prisma, storage, ai })
          .catch((err) => app.log.error({ err: err.message }, 'Inline worker gagal'))
          .finally(() => {
            draining = false;
          });
      });
    }
  : undefined;

const app = await buildApp({ prisma, storage, ai, onJobEnqueued });

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
