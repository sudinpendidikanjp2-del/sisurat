import { execSync } from 'node:child_process';
import path from 'node:path';

/** Applies migrations to the test database once before the suite. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://sisurat:sisurat@localhost:5432/sisurat_test?schema=public';
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
