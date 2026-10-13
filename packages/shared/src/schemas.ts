import { z } from 'zod';
import {
  CONFIDENTIALITY_LEVELS,
  LETTER_STATUSES,
  LETTER_TYPES,
  OUTGOING_STATUSES,
  OUTGOING_TYPES,
  PRIORITIES,
  PROCESSING_STATUSES,
  ROLE_CODES,
  AI_PROVIDERS,
  ASSIGNMENT_STATUSES,
} from './enums';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD');

/** Empty strings from HTML forms become null. */
const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

export const optionalText = (max = 500) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable().optional());
export const optionalDate = () => z.preprocess(emptyToNull, isoDate.nullable().optional());

export const idSchema = z.string().min(1).max(64);

// ---------- Auth ----------
export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Nama pengguna wajib diisi').max(100),
  password: z.string().min(1, 'Kata sandi wajib diisi').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const passwordPolicy = z
  .string()
  .min(10, 'Kata sandi minimal 10 karakter')
  .max(200)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), {
    message: 'Kata sandi harus mengandung huruf kecil, huruf besar, dan angka',
  });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Kata sandi lama wajib diisi'),
  newPassword: passwordPolicy,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: passwordPolicy,
});

// ---------- Users & roles ----------
export const userCreateSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9._-]+$/, 'Gunakan huruf kecil, angka, titik, garis bawah, atau tanda hubung'),
  fullName: z.string().trim().min(2).max(150),
  email: z.preprocess(emptyToNull, z.email('Email tidak valid').nullable().optional()),
  position: optionalText(150),
  unitId: z.preprocess(emptyToNull, idSchema.nullable().optional()),
  roles: z.array(z.enum(ROLE_CODES)).min(1, 'Pilih minimal satu peran'),
  password: passwordPolicy,
});
export type UserCreateInput = z.infer<typeof userCreateSchema>;

export const userUpdateSchema = userCreateSchema
  .omit({ password: true, username: true })
  .partial()
  .extend({ isActive: z.boolean().optional() });
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

export const rolePermissionsSchema = z.object({
  permissions: z.array(z.string().min(1).max(64)),
});

export const unitSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(150),
});

// ---------- Incoming letters ----------
export const letterMetadataSchema = z.object({
  letterType: z.preprocess(emptyToNull, z.enum(LETTER_TYPES).nullable().optional()),
  letterNumber: optionalText(150),
  letterDate: optionalDate(),
  receivedDate: optionalDate(),
  senderName: optionalText(250),
  recipientName: optionalText(250),
  subject: optionalText(500),
  attachmentText: optionalText(250),
  eventDate: optionalDate(),
  eventLocation: optionalText(250),
  summary: optionalText(4000),
  category: optionalText(100),
  priority: z.enum(PRIORITIES).optional(),
  confidentiality: z.enum(CONFIDENTIALITY_LEVELS).optional(),
  notes: optionalText(2000),
});
export type LetterMetadataInput = z.infer<typeof letterMetadataSchema>;

/** Body (multipart field `metadata`) for POST /api/incoming-letters. */
export const letterCreateSchema = letterMetadataSchema.extend({
  autoExtract: z.boolean().optional(),
});
export type LetterCreateInput = z.infer<typeof letterCreateSchema>;

const req = (label: string, max: number) =>
  z.string({ error: `${label} wajib diisi` }).trim().min(1, `${label} wajib diisi`).max(max);

/** Verification requires the key fields of PRD §9.4. */
export const letterVerifySchema = letterMetadataSchema.extend({
  letterNumber: req('Nomor surat', 150),
  letterDate: isoDate,
  receivedDate: isoDate,
  senderName: req('Pengirim', 250),
  recipientName: req('Penerima', 250),
  subject: req('Perihal', 500),
  extractionResultId: z.preprocess(emptyToNull, idSchema.nullable().optional()),
  /** Officer explicitly confirms a possible duplicate is not a duplicate. */
  confirmNotDuplicate: z.boolean().optional(),
});
export type LetterVerifyInput = z.infer<typeof letterVerifySchema>;

export const letterForwardSchema = z.object({
  leaderId: idSchema,
  note: optionalText(1000),
});

export const letterArchiveSchema = z.object({
  note: optionalText(1000),
});

export const reasonSchema = z.object({
  reason: z.string().trim().min(5, 'Alasan minimal 5 karakter').max(1000),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const letterListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(200).optional(),
  status: z.enum(LETTER_STATUSES).optional(),
  processingStatus: z.enum(PROCESSING_STATUSES).optional(),
  letterType: z.enum(LETTER_TYPES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  sender: z.string().trim().max(200).optional(),
  assigneeId: idSchema.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  archived: z.enum(['true', 'false']).optional(),
  sort: z.enum(['receivedDate', 'createdAt', 'letterDate', 'agendaNumber']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type LetterListQuery = z.infer<typeof letterListQuerySchema>;

// ---------- Dispositions & assignments ----------
export const dispositionCreateSchema = z.object({
  instruction: z.string().trim().min(3, 'Arahan wajib diisi').max(4000),
  priority: z.enum(PRIORITIES).default('NORMAL'),
  dueDate: optionalDate(),
  assigneeIds: z.array(idSchema).min(1, 'Pilih minimal satu pelaksana').max(20),
});
export type DispositionCreateInput = z.infer<typeof dispositionCreateSchema>;

export const workUpdateSchema = z.object({
  note: z.string().trim().min(1, 'Catatan wajib diisi').max(4000),
  progressPercent: z.coerce.number().int().min(0).max(100).optional(),
  submitForReview: z.coerce.boolean().optional(),
});
export type WorkUpdateInput = z.infer<typeof workUpdateSchema>;

export const reviewDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REQUEST_REVISION']),
  note: optionalText(4000),
});
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;

export const reassignSchema = z.object({
  newAssigneeId: idSchema,
  reason: z.string().trim().min(5).max(1000),
});

export const assignmentListQuerySchema = paginationSchema.extend({
  status: z.enum(ASSIGNMENT_STATUSES).optional(),
  scope: z.enum(['mine', 'review', 'all']).default('mine'),
  overdue: z.enum(['true', 'false']).optional(),
});

// ---------- Outgoing letters & templates ----------
export const outgoingCreateSchema = z.object({
  templateId: idSchema,
  subject: z.string().trim().min(3).max(500),
  recipient: z.string().trim().min(2).max(500),
  data: z.record(z.string(), z.string().max(5000)),
  incomingLetterIds: z.array(idSchema).max(20).default([]),
  dispositionId: z.preprocess(emptyToNull, idSchema.nullable().optional()),
  confidentiality: z.enum(CONFIDENTIALITY_LEVELS).default('BIASA'),
});
export type OutgoingCreateInput = z.infer<typeof outgoingCreateSchema>;

export const outgoingUpdateSchema = outgoingCreateSchema.omit({ templateId: true }).partial();

export const outgoingListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(200).optional(),
  status: z.enum(OUTGOING_STATUSES).optional(),
  type: z.enum(OUTGOING_TYPES).optional(),
});

export const placeholderDefSchema = z.object({
  key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  label: z.string().trim().min(1).max(150),
  required: z.boolean().default(true),
  multiline: z.boolean().default(false),
});
export type PlaceholderDef = z.infer<typeof placeholderDefSchema>;

export const templateUpdateSchema = z.object({
  name: z.string().trim().min(3).max(150).optional(),
  isActive: z.boolean().optional(),
  approvedByName: optionalText(150),
  activeFrom: optionalDate(),
  placeholders: z.array(placeholderDefSchema).optional(),
});

// ---------- Settings ----------
export const appSettingsSchema = z.object({
  organizationName: z.string().trim().min(2).max(200),
  agendaNumberFormat: z.string().trim().min(3).max(100).includes('{seq', { message: 'Format harus memuat {seq}' }),
  outgoingNumberFormat: z.string().trim().min(3).max(100).includes('{seq', { message: 'Format harus memuat {seq}' }),
  maxUploadMb: z.coerce.number().int().min(1).max(50),
  maxPdfPages: z.coerce.number().int().min(1).max(200),
  maxFilesPerLetter: z.coerce.number().int().min(1).max(30),
  autoExtractOnUpload: z.boolean(),
  aiEnabled: z.boolean(),
  primaryProvider: z.enum(AI_PROVIDERS),
  useAiForDigitalText: z.boolean(),
  minTextCharsPerPage: z.coerce.number().int().min(10).max(5000),
  deadlineReminderDays: z.coerce.number().int().min(0).max(30),
  rawResultRetentionDays: z.coerce.number().int().min(0).max(3650),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const providerConfigSchema = z.object({
  enabled: z.boolean(),
  model: z.string().trim().min(1).max(100),
  /** Organisation has reviewed the provider's data policy and approved sending documents. */
  approvedForExternal: z.boolean(),
  allowedConfidentiality: z.array(z.enum(CONFIDENTIALITY_LEVELS)),
  timeoutMs: z.coerce.number().int().min(5000).max(600000),
  maxAttempts: z.coerce.number().int().min(1).max(10),
  inputCostPerMTokUsd: z.preprocess(emptyToNull, z.coerce.number().min(0).nullable().optional()),
  outputCostPerMTokUsd: z.preprocess(emptyToNull, z.coerce.number().min(0).nullable().optional()),
  notes: optionalText(2000),
});
export type ProviderConfigInput = z.infer<typeof providerConfigSchema>;

export const reportQuerySchema = z.object({
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  status: z.enum(LETTER_STATUSES).optional(),
  letterType: z.enum(LETTER_TYPES).optional(),
  sender: z.string().trim().max(200).optional(),
  assigneeId: idSchema.optional(),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const auditQuerySchema = paginationSchema.extend({
  action: z.string().trim().max(100).optional(),
  entityType: z.string().trim().max(50).optional(),
  entityId: idSchema.optional(),
  actorId: idSchema.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

// ---------- AI extraction output (PRD §9.3) ----------
export const reviewFlagSchema = z.object({
  field: z.string(),
  code: z.enum(['MISSING', 'AMBIGUOUS', 'INVALID_FORMAT', 'CONFLICT', 'DUPLICATE_SUSPECT']),
  message: z.string().optional(),
});
export type ReviewFlag = z.infer<typeof reviewFlagSchema>;

export const evidenceSchema = z.object({
  field: z.string(),
  page: z.number().int().nullable().optional(),
  quote: z.string().max(500).nullable().optional(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const normalizedFieldsSchema = z.object({
  document_type: z.string().nullable(),
  letter_number: z.string().nullable(),
  letter_date: z.string().nullable(),
  letter_date_raw: z.string().nullable(),
  sender_name: z.string().nullable(),
  recipient_name: z.string().nullable(),
  subject: z.string().nullable(),
  attachment_text: z.string().nullable(),
  event_date: z.string().nullable(),
  event_date_raw: z.string().nullable(),
  event_location: z.string().nullable(),
  summary: z.string().nullable(),
  suggested_category: z.string().nullable(),
});
export type NormalizedFields = z.infer<typeof normalizedFieldsSchema>;
