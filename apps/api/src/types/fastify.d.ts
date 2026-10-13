import 'fastify';
import type { AuthUser } from '../lib/context';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
    sessionId?: string;
    csrfToken?: string;
  }
}
