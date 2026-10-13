import type { AiProvider } from '@sisurat/shared';
import type { Db, DbOrTx } from '../db';
import type { Deps } from '../lib/deps';
import { Prisma } from '../generated/prisma/client';
import { loadExtractionPolicy } from '../ai/policy';
import { ProviderError } from '../ai/types';
import { audit } from '../lib/audit';
import { notify } from '../lib/notify';
import { invalidState } from '../lib/errors';

const ACTIVE = ['QUEUED', 'RUNNING'] as const;
const MAX_BACKOFF_MS = 10 * 60_000;

/**
 * Enqueue extraction for a document. Idempotent: if a job for the same document is already
 * queued or running, that job is returned instead of creating a duplicate.
 */
export async function enqueueExtraction(
  db: Db,
  params: { documentId: string; requestedById: string | null; requestedProvider?: AiProvider | null },
) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${params.documentId}))`;
    const doc = await tx.document.findUnique({
      where: { id: params.documentId },
      include: { incomingLetter: true },
    });
    if (!doc || !doc.incomingLetter || doc.deletedAt) throw invalidState('Dokumen surat tidak ditemukan');
    if (doc.incomingLetter.processingStatus === 'VERIFIED') {
      throw invalidState('Metadata surat sudah diverifikasi; ekstraksi ulang tidak diperlukan');
    }
    const existing = await tx.extractionJob.findFirst({
      where: { documentId: doc.id, status: { in: [...ACTIVE] } },
    });
    if (existing) return { job: existing, created: false };

    const policy = await loadExtractionPolicy(tx);
    const providerId = params.requestedProvider ?? policy.primaryProvider;
    const maxAttempts = (await tx.aiProviderConfig.findUnique({ where: { provider: providerId } }))?.maxAttempts ?? 3;
    const job = await tx.extractionJob.create({
      data: {
        documentId: doc.id,
        incomingLetterId: doc.incomingLetter.id,
        requestedById: params.requestedById,
        requestedProvider: params.requestedProvider ?? null,
        maxAttempts,
      },
    });
    await tx.incomingLetter.update({ where: { id: doc.incomingLetter.id }, data: { processingStatus: 'PROCESSING' } });
    return { job, created: true };
  });
}

/** Atomically claims the next due job (safe with several worker processes). */
export async function claimNextJob(db: Db, workerId: string): Promise<string | null> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "ExtractionJob" SET status = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${workerId},
      "startedAt" = COALESCE("startedAt", now()), attempts = attempts + 1, "updatedAt" = now()
    WHERE id = (
      SELECT id FROM "ExtractionJob"
      WHERE status = 'QUEUED' AND "nextRunAt" <= now()
      ORDER BY "nextRunAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id`;
  return rows[0]?.id ?? null;
}

/** Requeues jobs whose worker died mid-run. */
export async function recoverStaleJobs(db: Db, staleAfterMs = 15 * 60_000) {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const res = await db.extractionJob.updateMany({
    where: { status: 'RUNNING', lockedAt: { lt: cutoff } },
    data: { status: 'QUEUED', lockedAt: null, lockedBy: null, nextRunAt: new Date() },
  });
  return res.count;
}

export function backoffMs(attempt: number, retryAfterMs?: number) {
  const exp = Math.min(MAX_BACKOFF_MS, 5000 * 2 ** Math.max(0, attempt - 1));
  return Math.max(exp, retryAfterMs ?? 0);
}

async function flagDuplicates(db: DbOrTx, letterId: string, letterNumber: string | null) {
  if (!letterNumber) return [];
  const dupes = await db.incomingLetter.findMany({
    where: {
      id: { not: letterId },
      deletedAt: null,
      letterNumber: { equals: letterNumber, mode: 'insensitive' },
    },
    select: { agendaNumber: true, senderName: true },
    take: 3,
  });
  return dupes.map((d) => ({
    field: 'letter_number',
    code: 'DUPLICATE_SUSPECT' as const,
    message: `Nomor surat sama dengan surat ${d.agendaNumber ?? '(draft)'} dari ${d.senderName ?? '-'}`,
  }));
}

export async function processJob(deps: Pick<Deps, 'prisma' | 'storage' | 'ai'>, jobId: string) {
  const { prisma, storage, ai } = deps;
  const job = await prisma.extractionJob.findUnique({
    where: { id: jobId },
    include: { document: true, incomingLetter: true },
  });
  if (!job || job.status !== 'RUNNING') return;
  const started = Date.now();
  const sys = { system: 'extraction-worker' } as const;

  try {
    if (!(await storage.exists(job.document.storageKey))) {
      throw new ProviderError('SOURCE_MISSING', 'Berkas sumber tidak ditemukan di penyimpanan');
    }
    const buffer = await storage.read(job.document.storageKey);
    const policy = await loadExtractionPolicy(prisma);
    const outcome = await ai.extractMetadata(
      {
        buffer,
        mimeType: job.document.mimeType,
        pageCount: job.document.pageCount,
        confidentiality: job.incomingLetter.confidentiality,
        requestedProvider: job.requestedProvider,
      },
      policy,
    );
    outcome.reviewFlags.push(...(await flagDuplicates(prisma, job.incomingLetterId, outcome.normalized.letter_number)));

    await prisma.$transaction(async (tx) => {
      const data = {
        rawOutput: (outcome.rawOutput ?? Prisma.DbNull) as Prisma.InputJsonValue,
        extractedTextChars: outcome.extractedTextChars,
        normalizedFields: outcome.normalized as unknown as Prisma.InputJsonValue,
        reviewFlags: outcome.reviewFlags as unknown as Prisma.InputJsonValue,
        evidence: outcome.evidence as unknown as Prisma.InputJsonValue,
      };
      // jobId is unique: a re-run of the same job overwrites instead of duplicating.
      await tx.extractionResult.upsert({ where: { jobId: job.id }, create: { jobId: job.id, ...data }, update: data });
      await tx.extractionJob.update({
        where: { id: job.id },
        data: {
          status: 'SUCCEEDED',
          method: outcome.method,
          provider: outcome.provider,
          model: outcome.model,
          promptVersion: outcome.promptVersion,
          finishedAt: new Date(),
          durationMs: Date.now() - started,
          inputTokens: outcome.inputTokens,
          outputTokens: outcome.outputTokens,
          pagesProcessed: outcome.pagesProcessed,
          estimatedCostUsd: outcome.estimatedCostUsd,
          errorCode: null,
          errorMessage: null,
          lockedAt: null,
          lockedBy: null,
        },
      });
      // Never overwrite a letter that has been verified in the meantime.
      await tx.incomingLetter.updateMany({
        where: { id: job.incomingLetterId, processingStatus: { not: 'VERIFIED' } },
        data: { processingStatus: 'NEEDS_REVIEW' },
      });
      if (job.requestedById) {
        await notify(tx, {
          userId: job.requestedById,
          type: 'EXTRACTION_FINISHED',
          title: 'Hasil ekstraksi siap diperiksa',
          message: `Draft metadata untuk dokumen "${job.document.originalName}" siap diverifikasi.`,
          entityType: 'IncomingLetter',
          entityId: job.incomingLetterId,
          link: `/surat-masuk/${job.incomingLetterId}/verifikasi`,
        });
      }
      await audit(tx, sys, {
        action: 'extraction.succeeded',
        entityType: 'ExtractionJob',
        entityId: job.id,
        after: {
          method: outcome.method,
          provider: outcome.provider,
          model: outcome.model,
          flags: outcome.reviewFlags.length,
          durationMs: Date.now() - started,
        },
      });
    });
  } catch (err) {
    const pe =
      err instanceof ProviderError ? err : Object.assign(new ProviderError('INTERNAL', 'Kesalahan internal saat memproses dokumen'), { retryable: true });
    const retry = pe.retryable && job.attempts < job.maxAttempts;
    await prisma.$transaction(async (tx) => {
      await tx.extractionJob.update({
        where: { id: job.id },
        data: retry
          ? {
              status: 'QUEUED',
              nextRunAt: new Date(Date.now() + backoffMs(job.attempts, pe.retryAfterMs)),
              errorCode: pe.code,
              errorMessage: pe.message,
              lockedAt: null,
              lockedBy: null,
            }
          : {
              status: 'FAILED',
              finishedAt: new Date(),
              durationMs: Date.now() - started,
              errorCode: pe.code,
              errorMessage: pe.message,
              lockedAt: null,
              lockedBy: null,
            },
      });
      if (!retry) {
        // The source document is kept; the officer can retry or fill the metadata manually.
        await tx.incomingLetter.updateMany({
          where: { id: job.incomingLetterId, processingStatus: { not: 'VERIFIED' } },
          data: { processingStatus: 'PROCESSING_FAILED' },
        });
        if (job.requestedById) {
          await notify(tx, {
            userId: job.requestedById,
            type: 'EXTRACTION_FAILED',
            title: 'Ekstraksi gagal',
            message: `Dokumen "${job.document.originalName}": ${pe.message}`,
            entityType: 'IncomingLetter',
            entityId: job.incomingLetterId,
            link: `/surat-masuk/${job.incomingLetterId}/verifikasi`,
          });
        }
      }
      await audit(tx, sys, {
        action: retry ? 'extraction.retry_scheduled' : 'extraction.failed',
        entityType: 'ExtractionJob',
        entityId: job.id,
        after: { errorCode: pe.code, attempt: job.attempts, maxAttempts: job.maxAttempts },
      });
    });
  }
}

/** Processes every job that is currently due (used by the inline worker and tests). */
export async function drainQueue(deps: Pick<Deps, 'prisma' | 'storage' | 'ai'>, workerId = 'inline', limit = 50) {
  let processed = 0;
  while (processed < limit) {
    const id = await claimNextJob(deps.prisma, workerId);
    if (!id) break;
    await processJob(deps, id);
    processed++;
  }
  return processed;
}
