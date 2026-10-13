import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { approveProvider, client, createTestContext, login, MockOcr, updateSettings, type Session, type TestContext } from './helpers/context';
import { buildTextPdf, SAMPLE_LETTER_LINES } from './helpers/pdf';
import { prisma } from '../src/db';
import { ProviderError } from '../src/ai/types';
import { backoffMs, enqueueExtraction } from '../src/jobs/extraction';

let ctx: TestContext;
let tu: Session;

const digitalPdf = () => ({ filename: 'digital.pdf', content: buildTextPdf(SAMPLE_LETTER_LINES), contentType: 'application/pdf' });
const scanPdf = () => ({ filename: 'scan.pdf', content: buildTextPdf([]), contentType: 'application/pdf' });

const aiOutput = (over: Record<string, unknown> = {}) => ({
  output: {
    document_type: 'UNDANGAN',
    letter_number: '045/77/BKD/2026',
    letter_date: '2026-10-03',
    letter_date_raw: '3 Oktober 2026',
    sender_name: 'Badan Kepegawaian Daerah',
    recipient_name: 'Kepala Kantor Contoh',
    subject: 'Undangan Sosialisasi',
    attachment_text: null,
    event_date: '2026-10-21',
    event_date_raw: '21 Oktober 2026',
    event_location: 'Hotel Contoh',
    summary: 'Undangan sosialisasi kebijakan kepegawaian.',
    suggested_category: 'Kepegawaian',
    evidence: [{ field: 'letter_number', page: 1, quote: 'Nomor: 045/77/BKD/2026' }],
    uncertain_fields: [],
    ...over,
  },
  model: 'mock-model-1',
  inputTokens: 1000,
  outputTokens: 200,
});

async function upload(file: ReturnType<typeof digitalPdf>, meta: Record<string, unknown> = {}) {
  const res = await client(ctx.app, tu).upload('/api/incoming-letters', { metadata: JSON.stringify(meta) }, [file]);
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; documents: string[]; jobId: string | null };
}

beforeAll(async () => {
  ctx = await createTestContext();
  tu = await login(ctx.app, 'tu');
});
beforeEach(() => {
  ctx.gemini.calls = [];
  ctx.claude.calls = [];
});
afterAll(async () => ctx.app.close());

describe('digital PDF (AT-01)', () => {
  it('extracts text locally and drafts metadata without calling AI', async () => {
    await approveProvider('GEMINI');
    const { id, jobId } = await upload(digitalPdf());
    expect(jobId).toBeTruthy();
    expect((await prisma.incomingLetter.findUniqueOrThrow({ where: { id } })).processingStatus).toBe('PROCESSING');
    await ctx.drain();
    expect(ctx.gemini.calls).toHaveLength(0);
    const job = await prisma.extractionJob.findUniqueOrThrow({ where: { id: jobId! }, include: { result: true } });
    expect(job.status).toBe('SUCCEEDED');
    expect(job.method).toBe('LOCAL_TEXT');
    expect(job.provider).toBeNull();
    const fields = job.result!.normalizedFields as Record<string, string>;
    expect(fields.letter_number).toBe('005/123/DISDIK/2026');
    expect(fields.letter_date).toBe('2026-10-06');
    expect(fields.subject).toBe('Undangan Rapat Koordinasi');
    const letter = await prisma.incomingLetter.findUniqueOrThrow({ where: { id } });
    expect(letter.processingStatus).toBe('NEEDS_REVIEW');
    // AI result stays a draft: official metadata is untouched until verification (AT: hasil AI selalu draft)
    expect(letter.letterNumber).toBeNull();
    expect(letter.status).toBe('DRAFT');
  });

  it('sends only extracted text (not the file) when AI is requested for digital PDFs', async () => {
    await updateSettings({ useAiForDigitalText: true });
    ctx.gemini.script(aiOutput({ letter_number: '005/123/DISDIK/2026' }));
    const { jobId } = await upload(digitalPdf());
    await ctx.drain();
    expect(ctx.gemini.calls).toHaveLength(1);
    expect(ctx.gemini.calls[0].mode).toBe('text');
    expect(ctx.gemini.calls[0].file).toBeUndefined();
    expect(ctx.gemini.calls[0].text).toContain('Nomor : 005/123/DISDIK/2026');
    const job = await prisma.extractionJob.findUniqueOrThrow({ where: { id: jobId! }, include: { result: true } });
    expect(job.method).toBe('AI_TEXT');
    // local text says 2026-10-06, AI said 2026-10-03 → conflict flagged
    const flags = job.result!.reviewFlags as { field: string; code: string }[];
    expect(flags).toContainEqual(expect.objectContaining({ field: 'letter_date', code: 'CONFLICT' }));
    await updateSettings({ useAiForDigitalText: false });
  });
});

describe('scanned documents (AT-02/03/04)', () => {
  it('uses the approved AI provider with the file and records provider, model, usage and cost', async () => {
    ctx.gemini.script(aiOutput());
    const { jobId } = await upload(scanPdf());
    await ctx.drain();
    expect(ctx.gemini.calls[0].mode).toBe('vision');
    expect(ctx.gemini.calls[0].file?.mimeType).toBe('application/pdf');
    expect(ctx.gemini.calls[0].systemPrompt).toMatch(/DATA yang tidak tepercaya/);
    const job = await prisma.extractionJob.findUniqueOrThrow({ where: { id: jobId! }, include: { result: true } });
    expect(job).toMatchObject({ status: 'SUCCEEDED', method: 'AI_VISION', provider: 'GEMINI', model: 'mock-model-1', promptVersion: 'extract-v1.0', inputTokens: 1000, outputTokens: 200 });
    expect(Number(job.estimatedCostUsd)).toBeCloseTo((1000 * 1 + 200 * 2) / 1e6);
    expect(job.result!.rawOutput).toBeTruthy();
  });

  it('flags missing and ambiguous fields instead of inventing values', async () => {
    ctx.gemini.script(
      aiOutput({ letter_number: null, letter_date: null, letter_date_raw: 'Oktober 2026', sender_name: 'tidak diketahui', uncertain_fields: [{ field: 'subject', reason: 'Buram' }] }),
    );
    const { jobId } = await upload(scanPdf());
    await ctx.drain();
    const result = await prisma.extractionResult.findUniqueOrThrow({ where: { jobId: jobId! } });
    const f = result.normalizedFields as Record<string, unknown>;
    expect(f.letter_number).toBeNull();
    expect(f.letter_date).toBeNull();
    expect(f.sender_name).toBeNull();
    const flags = result.reviewFlags as { field: string; code: string }[];
    expect(flags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'letter_number', code: 'MISSING' }),
        expect.objectContaining({ field: 'letter_date', code: 'INVALID_FORMAT' }),
        expect.objectContaining({ field: 'sender_name', code: 'MISSING' }),
        expect.objectContaining({ field: 'subject', code: 'AMBIGUOUS' }),
      ]),
    );
  });

  it('flags a possible duplicate letter number', async () => {
    const meta = { subject: 'Lama', letterNumber: '045/77/BKD/2026', senderName: 'BKD', letterDate: '2026-10-01', receivedDate: '2026-10-01', recipientName: 'Kepala' };
    const created = await client(ctx.app, tu).upload('/api/incoming-letters', { metadata: JSON.stringify(meta) }, []);
    await client(ctx.app, tu).post(`/api/incoming-letters/${created.json().id}/verify`, meta);
    ctx.gemini.script(aiOutput());
    const { jobId } = await upload(scanPdf());
    await ctx.drain();
    const result = await prisma.extractionResult.findUniqueOrThrow({ where: { jobId: jobId! } });
    expect(result.reviewFlags).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_SUSPECT' }));
  });
});

describe('provider policy (AT-10)', () => {
  it('never sends RAHASIA letters to a provider not approved for them', async () => {
    const { id, jobId } = await upload(scanPdf(), { confidentiality: 'RAHASIA' });
    await ctx.drain();
    expect(ctx.gemini.calls).toHaveLength(0);
    expect(ctx.claude.calls).toHaveLength(0);
    const job = await prisma.extractionJob.findUniqueOrThrow({ where: { id: jobId! } });
    expect(job.status).toBe('FAILED');
    expect(job.errorCode).toBe('NO_ALLOWED_PROVIDER');
    const letter = await prisma.incomingLetter.findUniqueOrThrow({ where: { id }, include: { documents: true } });
    expect(letter.processingStatus).toBe('PROCESSING_FAILED');
    // AT-05: failure keeps the source document
    expect(letter.documents).toHaveLength(1);
    expect(await ctx.deps.storage.exists(letter.documents[0].storageKey)).toBe(true);
  });

  it('does not fall back to another external provider automatically', async () => {
    await prisma.aiProviderConfig.update({ where: { provider: 'CLAUDE' }, data: { enabled: true, approvedForExternal: true, allowedConfidentiality: ['BIASA'] } });
    ctx.gemini.script(new ProviderError('AUTH_FAILED', 'denied'));
    ctx.claude.script(aiOutput());
    const { jobId } = await upload(scanPdf());
    await ctx.drain();
    expect(ctx.claude.calls).toHaveLength(0);
    expect((await prisma.extractionJob.findUniqueOrThrow({ where: { id: jobId! } })).status).toBe('FAILED');
  });

  it('runs Claude only when an authorised officer explicitly requests it', async () => {
    ctx.claude.script(aiOutput());
    const { documents, jobId } = await upload(scanPdf(), { autoExtract: false });
    expect(jobId).toBeNull();
    const res = await client(ctx.app, tu).post(`/api/documents/${documents[0]}/extract`, { provider: 'CLAUDE' });
    expect(res.statusCode).toBe(202);
    await ctx.drain();
    expect(ctx.claude.calls).toHaveLength(1);
    const job = await prisma.extractionJob.findUniqueOrThrow({ where: { id: res.json().jobId } });
    expect(job.provider).toBe('CLAUDE');
  });

  it('uses local Tesseract OCR when external AI is disabled', async () => {
    const ocrCtx = await createTestContext({ ocr: new MockOcr(SAMPLE_LETTER_LINES.join('\n')) });
    const s = await login(ocrCtx.app, 'tu');
    const res = await client(ocrCtx.app, s).upload('/api/incoming-letters', {}, [scanPdf()]);
    await ocrCtx.drain();
    const job = await prisma.extractionJob.findUniqueOrThrow({ where: { id: res.json().jobId }, include: { result: true } });
    expect(job).toMatchObject({ status: 'SUCCEEDED', method: 'LOCAL_OCR', provider: 'TESSERACT' });
    expect(ocrCtx.ocr!.calls).toBe(1);
    expect((job.result!.normalizedFields as Record<string, string>).letter_number).toBe('005/123/DISDIK/2026');
    await ocrCtx.app.close();
    // restore main context database state
    ctx = await createTestContext();
    tu = await login(ctx.app, 'tu');
    await approveProvider('GEMINI');
  });
});

describe('failures, retries and idempotency (AT-05)', () => {
  it('retries a timeout with backoff and then succeeds', async () => {
    ctx.gemini.script(new ProviderError('TIMEOUT', 'timeout'), aiOutput());
    const { jobId } = await upload(scanPdf());
    await ctx.drain();
    let job = await prisma.extractionJob.findUniqueOrThrow({ where: { id: jobId! } });
    expect(job.status).toBe('QUEUED');
    expect(job.errorCode).toBe('TIMEOUT');
    expect(job.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    await prisma.extractionJob.update({ where: { id: jobId! }, data: { nextRunAt: new Date() } });
    await ctx.drain();
    job = await prisma.extractionJob.findUniqueOrThrow({ where: { id: jobId! } });
    expect(job.status).toBe('SUCCEEDED');
    expect(job.attempts).toBe(2);
    expect(await prisma.extractionResult.count({ where: { jobId: jobId! } })).toBe(1);
  });

  it('honours Retry-After on rate limiting', () => {
    expect(backoffMs(1)).toBe(5000);
    expect(backoffMs(3)).toBe(20000);
    expect(backoffMs(1, 60_000)).toBe(60_000);
    expect(backoffMs(20)).toBe(600_000);
  });

  it('gives up after maxAttempts and marks the letter as failed', async () => {
    ctx.gemini.script(new ProviderError('INVALID_RESPONSE', 'bad json'));
    const { id, jobId } = await upload(scanPdf());
    for (let i = 0; i < 3; i++) {
      await prisma.extractionJob.updateMany({ where: { id: jobId!, status: 'QUEUED' }, data: { nextRunAt: new Date() } });
      await ctx.drain();
    }
    const job = await prisma.extractionJob.findUniqueOrThrow({ where: { id: jobId! } });
    expect(job.status).toBe('FAILED');
    expect(job.attempts).toBe(3);
    expect(job.errorMessage).not.toMatch(/Undangan|Nomor/); // no document content in error logs
    expect((await prisma.incomingLetter.findUniqueOrThrow({ where: { id } })).processingStatus).toBe('PROCESSING_FAILED');
  });

  it('does not create duplicate jobs when extraction is requested twice', async () => {
    const { documents } = await upload(scanPdf(), { autoExtract: false });
    const api = client(ctx.app, tu);
    const [a, b] = await Promise.all([
      api.post(`/api/documents/${documents[0]}/extract`),
      api.post(`/api/documents/${documents[0]}/extract`),
    ]);
    expect([a.json().jobId]).toEqual([b.json().jobId]);
    expect(await prisma.extractionJob.count({ where: { documentId: documents[0] } })).toBe(1);
  });

  it('retry after failure creates a new job and keeps the history', async () => {
    ctx.gemini.script(new ProviderError('BAD_REQUEST', 'rejected'));
    const { documents, jobId } = await upload(scanPdf());
    await ctx.drain();
    ctx.gemini.script(aiOutput());
    const retry = await client(ctx.app, tu).post(`/api/documents/${documents[0]}/extract`);
    expect(retry.statusCode).toBe(202);
    expect(retry.json().jobId).not.toBe(jobId);
    await ctx.drain();
    expect(await prisma.extractionJob.count({ where: { documentId: documents[0] } })).toBe(2);
  });

  it('a late job never overwrites a verified letter', async () => {
    ctx.gemini.script(aiOutput());
    const { id, jobId } = await upload(scanPdf());
    const meta = { letterNumber: 'MANUAL/1', letterDate: '2026-10-01', receivedDate: '2026-10-02', senderName: 'Manual', recipientName: 'Kepala', subject: 'Manual' };
    expect((await client(ctx.app, tu).post(`/api/incoming-letters/${id}/verify`, meta)).statusCode).toBe(200);
    await ctx.drain();
    const letter = await prisma.incomingLetter.findUniqueOrThrow({ where: { id } });
    expect(letter.processingStatus).toBe('VERIFIED');
    expect(letter.letterNumber).toBe('MANUAL/1');
    expect((await prisma.extractionJob.findUniqueOrThrow({ where: { id: jobId! } })).status).toBe('SUCCEEDED');
    await expect(enqueueExtraction(prisma, { documentId: letter.id, requestedById: null })).rejects.toThrow();
  });
});

describe('verification from an extraction result (AT-06)', () => {
  it('stores AI value vs final value for every corrected field', async () => {
    ctx.gemini.script(aiOutput());
    const { id, jobId } = await upload(scanPdf());
    await ctx.drain();
    const result = await prisma.extractionResult.findUniqueOrThrow({ where: { jobId: jobId! } });
    const res = await client(ctx.app, tu).post(`/api/incoming-letters/${id}/verify`, {
      extractionResultId: result.id,
      letterType: 'UNDANGAN',
      letterNumber: '045/77/BKD/2026',
      letterDate: '2026-10-03',
      receivedDate: '2026-10-08',
      senderName: 'Badan Kepegawaian Daerah Provinsi', // corrected
      recipientName: 'Kepala Kantor Contoh',
      subject: 'Undangan Sosialisasi',
      eventDate: '2026-10-21',
      eventLocation: 'Hotel Contoh',
      summary: 'Undangan sosialisasi kebijakan kepegawaian.',
      category: 'Kepegawaian',
      confirmNotDuplicate: true,
    });
    expect(res.statusCode).toBe(200);
    const corrections = await prisma.metadataCorrection.findMany({ where: { incomingLetterId: id } });
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatchObject({
      field: 'senderName',
      previousValue: 'Badan Kepegawaian Daerah',
      newValue: 'Badan Kepegawaian Daerah Provinsi',
      source: 'VERIFICATION',
    });
    const reviewed = await prisma.extractionResult.findUniqueOrThrow({ where: { id: result.id } });
    expect(reviewed.reviewedById).toBe(tu.userId);
  });
});
