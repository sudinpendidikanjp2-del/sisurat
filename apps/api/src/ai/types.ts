import type { AiProvider, Confidentiality, ExtractionMethod, Evidence, NormalizedFields, ReviewFlag } from '@sisurat/shared';

export type ProviderMode = 'text' | 'vision';

export interface ProviderRequest {
  mode: ProviderMode;
  /** Locally extracted text (mode = text). Treated as untrusted data. */
  text?: string;
  /** Original file (mode = vision). */
  file?: { buffer: Buffer; mimeType: string };
  model: string;
  timeoutMs: number;
  systemPrompt: string;
  userPrompt: string;
}

export interface ProviderResponse {
  /** Parsed JSON object returned by the model (validated later by normalize()). */
  output: unknown;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

/** Structured-extraction provider (Gemini, Claude, test mocks). */
export interface StructuredExtractionProvider {
  readonly id: AiProvider;
  /** Whether a credential is present on the server. Never exposes the credential itself. */
  isConfigured(): boolean;
  supports(mode: ProviderMode, mimeType?: string): boolean;
  extract(req: ProviderRequest): Promise<ProviderResponse>;
}

/** Local OCR engine (Tesseract). */
export interface OcrEngine {
  isAvailable(): Promise<boolean>;
  recognize(file: { buffer: Buffer; mimeType: string }, timeoutMs: number): Promise<{ text: string; pages: number }>;
}

export type ProviderErrorCode =
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'AUTH_FAILED'
  | 'BAD_REQUEST'
  | 'NOT_CONFIGURED'
  | 'NO_ALLOWED_PROVIDER'
  | 'OCR_FAILED'
  | 'SOURCE_MISSING'
  | 'INTERNAL';

const RETRYABLE: ProviderErrorCode[] = ['TIMEOUT', 'RATE_LIMITED', 'UNAVAILABLE', 'INVALID_RESPONSE'];

/**
 * Errors carry only a code and a short operator-safe message — never document content.
 */
export class ProviderError extends Error {
  readonly retryable: boolean;
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.retryable = RETRYABLE.includes(code);
  }
}

/** Effective per-provider policy resolved from AiProviderConfig + app settings. */
export interface ProviderPolicy {
  provider: AiProvider;
  enabled: boolean;
  approvedForExternal: boolean;
  allowedConfidentiality: Confidentiality[];
  model: string;
  timeoutMs: number;
  inputCostPerMTokUsd: number | null;
  outputCostPerMTokUsd: number | null;
}

export interface ExtractionPolicy {
  aiEnabled: boolean;
  primaryProvider: AiProvider;
  useAiForDigitalText: boolean;
  minTextCharsPerPage: number;
  providers: Record<AiProvider, ProviderPolicy | undefined>;
}

export interface ExtractionInput {
  buffer: Buffer;
  mimeType: string;
  pageCount: number | null;
  confidentiality: Confidentiality;
  /** Explicit provider chosen by an authorised officer (e.g. comparison run). Still subject to policy. */
  requestedProvider?: AiProvider | null;
}

export interface ExtractionOutcome {
  method: ExtractionMethod;
  provider: AiProvider | null;
  model: string | null;
  promptVersion: string | null;
  normalized: NormalizedFields;
  reviewFlags: ReviewFlag[];
  evidence: Evidence[];
  rawOutput: unknown;
  extractedTextChars: number;
  pagesProcessed: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
}
