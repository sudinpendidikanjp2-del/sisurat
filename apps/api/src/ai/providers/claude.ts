import Anthropic from '@anthropic-ai/sdk';
import { extractionJsonSchema, wrapDocumentText } from '../prompt';
import { mapHttpError, parseJsonText } from './gemini';
import { ProviderError, type ProviderMode, type ProviderRequest, type ProviderResponse, type StructuredExtractionProvider } from '../types';

const IMAGE_MIME = new Set(['image/png', 'image/jpeg']);

/**
 * Claude adapter (alternative provider). Uses structured outputs (output_config.format) so the reply
 * is schema-valid JSON, and the server-side refusal fallback so a safety refusal is retried on
 * another Claude model instead of failing the job.
 */
export class ClaudeProvider implements StructuredExtractionProvider {
  readonly id = 'CLAUDE' as const;
  private client: Anthropic | null;

  constructor(private readonly apiKey: string | undefined) {
    // maxRetries: 0 — retries are owned by the job queue so attempts are counted and audited.
    this.client = apiKey ? new Anthropic({ apiKey, maxRetries: 0 }) : null;
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  supports(mode: ProviderMode, mimeType?: string) {
    return mode === 'text' || !mimeType || mimeType === 'application/pdf' || IMAGE_MIME.has(mimeType);
  }

  async extract(req: ProviderRequest): Promise<ProviderResponse> {
    if (!this.client) throw new ProviderError('NOT_CONFIGURED', 'CLAUDE_API_KEY belum dikonfigurasi');
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (req.mode === 'vision' && req.file) {
      const data = req.file.buffer.toString('base64');
      if (req.file.mimeType === 'application/pdf') {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
      } else {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: req.file.mimeType as 'image/png' | 'image/jpeg', data },
        });
      }
      content.push({ type: 'text', text: req.userPrompt });
    } else {
      content.push({ type: 'text', text: `${req.userPrompt}\n\n${wrapDocumentText(req.text ?? '')}` });
    }

    try {
      const res = await this.client.beta.messages.create(
        {
          model: req.model,
          max_tokens: 16000,
          system: req.systemPrompt,
          messages: [{ role: 'user', content }],
          output_config: { format: { type: 'json_schema', schema: extractionJsonSchema() } },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        },
        { timeout: req.timeoutMs },
      );
      if (res.stop_reason === 'refusal') {
        throw new ProviderError('BAD_REQUEST', 'Provider menolak memproses dokumen ini');
      }
      if (res.stop_reason === 'max_tokens') {
        throw new ProviderError('INVALID_RESPONSE', 'Keluaran provider terpotong');
      }
      const text = res.content.find((b) => b.type === 'text');
      return {
        output: parseJsonText(text && 'text' in text ? text.text : undefined),
        model: res.model,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (err instanceof Anthropic.APIConnectionTimeoutError) {
        throw new ProviderError('TIMEOUT', 'Batas waktu pemanggilan Claude terlampaui');
      }
      if (err instanceof Anthropic.RateLimitError) {
        const ra = Number(err.headers?.get('retry-after'));
        throw mapHttpError(429, Number.isFinite(ra) ? ra * 1000 : undefined);
      }
      if (err instanceof Anthropic.APIError && err.status) throw mapHttpError(err.status);
      if (err instanceof Anthropic.APIConnectionError) throw new ProviderError('UNAVAILABLE', 'Gagal menghubungi Claude');
      throw new ProviderError('UNAVAILABLE', 'Gagal memanggil Claude');
    }
  }
}
