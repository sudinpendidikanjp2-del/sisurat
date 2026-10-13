import path from 'node:path';
import os from 'node:os';
import { defineConfig } from 'vitest/config';

const testDb = process.env.TEST_DATABASE_URL ?? 'postgresql://sisurat:sisurat@localhost:5432/sisurat_test?schema=public';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/globalSetup.ts'],
    // Integration tests share one database; run files sequentially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDb,
      DOCUMENT_STORAGE_PATH: path.join(os.tmpdir(), 'sisurat-test-storage'),
      GEMINI_API_KEY: '',
      CLAUDE_API_KEY: '',
      LOG_LEVEL: 'silent',
    },
  },
});
