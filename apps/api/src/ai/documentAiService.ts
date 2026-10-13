import type { AiProvider, Confidentiality, Evidence, NormalizedFields, ReviewFlag } from '@sisurat/shared';
import { compareReadings, normalizeOutput } from './normalize';
import { heuristicIsSufficient, parseLetterText } from './heuristics';
import { extractPdfText, isTextSufficient } from './pdfText';
import { PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt } from './prompt';
import { parseFlexibleDate } from './dateParse';
import {
  ProviderError,
  type ExtractionInput,
  type ExtractionOutcome,
  type ExtractionPolicy,
  type OcrEngine,
  type ProviderPolicy,
  type StructuredExtractionProvider,
} from './types';

/** Max characters of local text sent to an AI provider; longer letters are flagged, not silently cut. */
const MAX_AI_TEXT_CHARS = 120_000;

export interface ProviderStatus {
  provider: AiProvider;
  configured: boolean;
}

/**
 * Provider-neutral entry point for OCR + metadata extraction (PRD §9).
 *
 * Routing:
 *  1. PDF with an adequate text layer → local text. If the rule-based reader finds the key fields
 *     (and the admin has not asked for AI on digital text) no AI call is made.
 *  2. Otherwise, the configured primary (or explicitly requested) provider is used — only if the
 *     organisation approved it for external processing and for this confidentiality level.
 *     Digital PDFs send extracted text only; scans/images send the file (vision).
 *  3. Scans with no allowed AI provider fall back to local Tesseract OCR when installed.
 *  4. Otherwise the job fails with NO_ALLOWED_PROVIDER and the officer registers manually.
 *  There is never an automatic switch to a different external provider.
 */
export class DocumentAIService {
  constructor(
    private readonly providers: Partial<Record<AiProvider, StructuredExtractionProvider>>,
    private readonly ocr: OcrEngine | null,
  ) {}

  providerStatus(): ProviderStatus[] {
    return (['GEMINI', 'CLAUDE'] as const).map((p) => ({ provider: p, configured: Boolean(this.providers[p]?.isConfigured()) }));
  }

  async ocrAvailable(): Promise<boolean> {
    return this.ocr ? this.ocr.isAvailable() : false;
  }

  /** Returns the provider allowed for this document, or a reason why none is. */
  resolveAiProvider(
    policy: ExtractionPolicy,
    confidentiality: Confidentiality,
    requested?: AiProvider | null,
  ): { provider: StructuredExtractionProvider; config: ProviderPolicy } | { reason: string } {
    if (!policy.aiEnabled) return { reason: 'Pemrosesan AI eksternal dinonaktifkan' };
    const id = requested ?? policy.primaryProvider;
    if (id === 'TESSERACT') return { reason: 'Provider utama adalah OCR lokal' };
    const config = policy.providers[id];
    const provider = this.providers[id];
    if (!config || !provider) return { reason: `Provider ${id} tidak tersedia` };
    if (!config.enabled) return { reason: `Provider ${id} tidak diaktifkan` };
    if (!config.approvedForExternal) return { reason: `Provider ${id} belum disetujui untuk pemrosesan eksternal` };
    if (!config.allowedConfidentiality.includes(confidentiality)) {
      return { reason: `Surat berklasifikasi ${confidentiality} tidak diizinkan dikirim ke ${id}` };
    }
    if (!provider.isConfigured()) return { reason: `API key ${id} belum dikonfigurasi` };
    return { provider, config };
  }

  async extractMetadata(input: ExtractionInput, policy: ExtractionPolicy): Promise<ExtractionOutcome> {
    const isPdf = input.mimeType === 'application/pdf';
    let localPages: string[] | null = null;
    let localChars = 0;
    let pageCount = input.pageCount;

    if (isPdf) {
      try {
        const t = await extractPdfText(input.buffer);
        pageCount = t.pageCount;
        if (isTextSufficient(t, policy.minTextCharsPerPage)) {
          localPages = t.pages;
          localChars = t.totalChars;
        }
      } catch {
        // Unreadable text layer: treat as scan.
      }
    }

    const ai = this.resolveAiProvider(policy, input.confidentiality, input.requestedProvider);

    // --- Digital PDF ---
    if (localPages) {
      const heuristic = parseLetterText(localPages);
      const localOnly = !policy.useAiForDigitalText && heuristicIsSufficient(heuristic) && !input.requestedProvider;
      if (localOnly || 'reason' in ai) {
        return this.fromLocal('LOCAL_TEXT', heuristic, localChars, pageCount, 'reason' in ai && !localOnly ? ai.reason : null);
      }
      const text = localPages.map((p, i) => `--- Halaman ${i + 1} ---\n${p}`).join('\n');
      const truncated = text.length > MAX_AI_TEXT_CHARS;
      const outcome = await this.callProvider(ai.provider, ai.config, {
        mode: 'text',
        text: text.slice(0, MAX_AI_TEXT_CHARS),
      });
      const fromText = normalizeOutput(heuristic).normalized;
      outcome.reviewFlags.push(...compareReadings(outcome.normalized, fromText));
      if (truncated) {
        outcome.reviewFlags.push({ field: 'summary', code: 'AMBIGUOUS', message: 'Dokumen sangat panjang; hanya sebagian teks yang dibaca AI' });
      }
      return { ...outcome, method: 'AI_TEXT', extractedTextChars: localChars, pagesProcessed: pageCount };
    }

    // --- Scan / image ---
    if (!('reason' in ai) && ai.provider.supports('vision', input.mimeType)) {
      const outcome = await this.callProvider(ai.provider, ai.config, {
        mode: 'vision',
        file: { buffer: input.buffer, mimeType: input.mimeType },
      });
      return { ...outcome, method: 'AI_VISION', pagesProcessed: pageCount };
    }

    const tesseractAllowed = policy.providers.TESSERACT?.enabled ?? false;
    if (this.ocr && tesseractAllowed && (await this.ocr.isAvailable())) {
      const timeoutMs = policy.providers.TESSERACT?.timeoutMs ?? 120_000;
      const { text, pages } = await this.ocr.recognize({ buffer: input.buffer, mimeType: input.mimeType }, timeoutMs);
      const heuristic = parseLetterText(text.split('\f'));
      const out = this.fromLocal('LOCAL_OCR', heuristic, text.replace(/\s+/g, '').length, pages, null);
      return { ...out, provider: 'TESSERACT', model: 'tesseract' };
    }

    const reason = 'reason' in ai ? ai.reason : `Provider ${ai.provider.id} tidak mendukung jenis berkas ini`;
    throw new ProviderError(
      'NO_ALLOWED_PROVIDER',
      `Dokumen hasil scan memerlukan OCR/AI, tetapi tidak ada jalur yang diizinkan (${reason}). Silakan isi metadata secara manual.`,
    );
  }

  private fromLocal(
    method: 'LOCAL_TEXT' | 'LOCAL_OCR',
    heuristic: ReturnType<typeof parseLetterText>,
    chars: number,
    pages: number | null,
    aiSkippedReason: string | null,
  ): ExtractionOutcome {
    const { normalized, reviewFlags, evidence } = normalizeOutput(heuristic);
    if (aiSkippedReason && !heuristicIsSufficient(heuristic)) {
      reviewFlags.push({ field: 'summary', code: 'AMBIGUOUS', message: `Dibaca tanpa AI: ${aiSkippedReason}` });
    }
    return {
      method,
      provider: null,
      model: null,
      promptVersion: 'heuristic-v1',
      normalized,
      reviewFlags,
      evidence,
      rawOutput: heuristic,
      extractedTextChars: chars,
      pagesProcessed: pages,
      inputTokens: null,
      outputTokens: null,
      estimatedCostUsd: null,
    };
  }

  private async callProvider(
    provider: StructuredExtractionProvider,
    config: ProviderPolicy,
    req: { mode: 'text' | 'vision'; text?: string; file?: { buffer: Buffer; mimeType: string } },
  ): Promise<ExtractionOutcome> {
    const res = await provider.extract({
      ...req,
      model: config.model,
      timeoutMs: config.timeoutMs,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(req.mode),
    });
    const { normalized, reviewFlags, evidence } = normalizeOutput(res.output);
    const cost =
      res.inputTokens != null && res.outputTokens != null && config.inputCostPerMTokUsd != null && config.outputCostPerMTokUsd != null
        ? (res.inputTokens * config.inputCostPerMTokUsd + res.outputTokens * config.outputCostPerMTokUsd) / 1_000_000
        : null;
    return {
      method: req.mode === 'vision' ? 'AI_VISION' : 'AI_TEXT',
      provider: provider.id,
      model: res.model,
      promptVersion: PROMPT_VERSION,
      normalized,
      reviewFlags,
      evidence,
      rawOutput: res.output,
      extractedTextChars: 0,
      pagesProcessed: null,
      inputTokens: res.inputTokens ?? null,
      outputTokens: res.outputTokens ?? null,
      estimatedCostUsd: cost,
    };
  }
}

export type { NormalizedFields, ReviewFlag, Evidence };
export { parseFlexibleDate };
