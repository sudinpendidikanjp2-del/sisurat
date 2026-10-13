import { appSettingsSchema, type AppSettings } from '@sisurat/shared';
import type { DbOrTx } from '../db';
import { env } from '../config/env';

export const DEFAULT_SETTINGS: AppSettings = {
  organizationName: 'Instansi Contoh',
  agendaNumberFormat: '{seq:4}/AG/{roman_month}/{yyyy}',
  outgoingNumberFormat: '{seq:3}/{code}/{roman_month}/{yyyy}',
  maxUploadMb: 15,
  maxPdfPages: 30,
  maxFilesPerLetter: 10,
  autoExtractOnUpload: true,
  // External AI stays off until the organisation approves a provider (PRD §12, §22).
  aiEnabled: false,
  primaryProvider: env.AI_PROVIDER,
  useAiForDigitalText: false,
  minTextCharsPerPage: 80,
  deadlineReminderDays: 2,
  rawResultRetentionDays: 90,
};

const KEY = 'app';

export async function getSettings(db: DbOrTx): Promise<AppSettings> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } });
  const merged = { ...DEFAULT_SETTINGS, ...((row?.value as Partial<AppSettings>) ?? {}) };
  const parsed = appSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(db: DbOrTx, value: AppSettings, userId: string | null) {
  await db.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value, updatedById: userId },
    update: { value, updatedById: userId },
  });
}
