/**
 * Zero-config local defaults. They match docker-compose.yml so `docker compose up -d db`
 * followed by `npm run setup` works without writing a .env file first.
 * Never rely on these in production — set real values via environment variables.
 */
export const DEFAULT_DATABASE_URL = 'postgresql://sisurat:sisurat@localhost:5432/sisurat?schema=public';
