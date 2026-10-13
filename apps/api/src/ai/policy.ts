import type { AiProvider } from '@sisurat/shared';
import type { DbOrTx } from '../db';
import { getSettings } from '../lib/settings';
import type { ExtractionPolicy, ProviderPolicy } from './types';

export async function loadExtractionPolicy(db: DbOrTx): Promise<ExtractionPolicy> {
  const [settings, rows] = await Promise.all([getSettings(db), db.aiProviderConfig.findMany()]);
  const providers = {} as Record<AiProvider, ProviderPolicy | undefined>;
  for (const r of rows) {
    providers[r.provider] = {
      provider: r.provider,
      enabled: r.enabled,
      approvedForExternal: r.approvedForExternal,
      allowedConfidentiality: r.allowedConfidentiality,
      model: r.model,
      timeoutMs: r.timeoutMs,
      inputCostPerMTokUsd: r.inputCostPerMTokUsd != null ? Number(r.inputCostPerMTokUsd) : null,
      outputCostPerMTokUsd: r.outputCostPerMTokUsd != null ? Number(r.outputCostPerMTokUsd) : null,
    };
  }
  return {
    aiEnabled: settings.aiEnabled,
    primaryProvider: settings.primaryProvider,
    useAiForDigitalText: settings.useAiForDigitalText,
    minTextCharsPerPage: settings.minTextCharsPerPage,
    providers,
  };
}
