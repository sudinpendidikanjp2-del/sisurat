import type { Db } from '../db';
import type { DocumentStorage } from '../storage/storage';
import type { DocumentAIService } from '../ai/documentAiService';

/** Explicit dependency container, so tests can inject a test DB, temp storage and mock AI providers. */
export interface Deps {
  prisma: Db;
  storage: DocumentStorage;
  ai: DocumentAIService;
  /** Called after an extraction job is enqueued (inline worker in dev/test). */
  onJobEnqueued?: () => void;
}
