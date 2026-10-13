import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';
import { DEFAULT_DATABASE_URL } from './src/config/defaults';

export default defineConfig({
  schema: path.join(import.meta.dirname, '../../prisma/schema.prisma'),
  migrations: {
    path: path.join(import.meta.dirname, '../../prisma/migrations'),
    seed: 'tsx src/seed/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
  },
});
