import { ApiError, GoogleGenAI } from '@google/genai';
import { extractionJsonSchema, wrapDocumentText } from '../prompt';
import { ProviderError, type ProviderMode, type ProviderRequest, type ProviderResponse, type StructuredExtractionProvider } from '../types';

const VISION_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg']);

export function mapHttpError(status: number | undefined, retryAfterMs?: number): ProviderError {
  if (status === 429) return new ProviderError('RATE_LIMITED', 'Provider membatasi laju permintaan', retryAfterMs);
  if (status === 401 || status === 403) return new ProviderError('AUTH_FAILED', 'Kredensial provider ditolak');
  if (status === 408 || status === 504) return new ProviderError('TIMEOUT', 'Provider tidak merespons tepat waktu');
  if (status && status >= 500) return new ProviderError('UNAVAILABLE', `Provider tidak tersedia (HTTP ${status})`);
  return new ProviderError('BAD_REQUEST', `Permintaan ditolak provider (HTTP ${status ?? '?'})`);
}

export function parseJsonText(text: string | undefined): unknown {
  if (!text) throw new ProviderError('INVALID_RESPONSE', 'Provider tidak mengembalikan teks');
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError('INVALID_RESPONSE', 'Keluaran provider bukan JSON yang valid');
  }
}

export class GeminiProvider implements StructuredExtractionProvider {
  readonly id = 'GEMINI' as const;
  private client: GoogleGenAI | null;

  constructor(private readonly apiKey: string | undefined) {
    this.client = apiKey ? new GoogleGenAI({ apiKey }) : null;
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  supports(mode: ProviderMode, mimeType?: string) {
    return mode === 'text' || (mimeType ? VISION_MIME.has(mimeType) : true);
  }

  async extract(req: ProviderRequest): Promise<ProviderResponse> {
    if (!this.client) throw new ProviderError('NOT_CONFIGURED', 'GEMINI_API_KEY belum dikonfigurasi');
    const parts =
      req.mode === 'vision' && req.file
        ? [{ inlineData: { mimeType: req.file.mimeType, data: req.file.buffer.toString('base64') } }, { text: req.userPrompt }]
        : [{ text: `${req.userPrompt}\n\n${wrapDocumentText(req.text ?? '')}` }];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    try {
      const res = await this.client.models.generateContent({
        model: req.model,
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction: req.systemPrompt,
          responseMimeType: 'application/json',
          responseJsonSchema: extractionJsonSchema(),
          temperature: 0,
          abortSignal: controller.signal,
          httpOptions: { timeout: req.timeoutMs },
        },
      });
      return {
        output: parseJsonText(res.text),
        model: res.modelVersion ?? req.model,
        inputTokens: res.usageMetadata?.promptTokenCount,
        outputTokens:
          (res.usageMetadata?.candidatesTokenCount ?? 0) + (res.usageMetadata?.thoughtsTokenCount ?? 0) || undefined,
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (controller.signal.aborted) throw new ProviderError('TIMEOUT', 'Batas waktu pemanggilan Gemini terlampaui');
      if (err instanceof ApiError) throw mapHttpError(err.status);
      throw new ProviderError('UNAVAILABLE', 'Gagal menghubungi Gemini');
    } finally {
      clearTimeout(timer);
    }
  }
}
