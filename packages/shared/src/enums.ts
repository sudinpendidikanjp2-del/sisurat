// String enums shared by API and web. Values must match the Prisma enums in prisma/schema.prisma.

export const ROLE_CODES = ['ADMIN', 'REGISTRAR', 'LEADER', 'STAFF', 'AUDITOR'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

/** Business status of an incoming letter (PRD §7, minus the processing statuses). */
export const LETTER_STATUSES = [
  'DRAFT',
  'REGISTERED',
  'AWAITING_DISPOSITION',
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING_REVIEW',
  'NEEDS_REVISION',
  'COMPLETED',
  'ARCHIVED',
  'CANCELLED',
] as const;
export type LetterStatus = (typeof LETTER_STATUSES)[number];

/** OCR/AI intake status, kept separate from the business status. */
export const PROCESSING_STATUSES = [
  'UPLOADED',
  'PROCESSING',
  'NEEDS_REVIEW',
  'PROCESSING_FAILED',
  'VERIFIED',
] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export const CONFIDENTIALITY_LEVELS = ['BIASA', 'TERBATAS', 'RAHASIA'] as const;
export type Confidentiality = (typeof CONFIDENTIALITY_LEVELS)[number];

export const PRIORITIES = ['RENDAH', 'NORMAL', 'TINGGI', 'SEGERA'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const LETTER_TYPES = [
  'UNDANGAN',
  'PEMBERITAHUAN',
  'PERMOHONAN',
  'EDARAN',
  'TUGAS',
  'KETERANGAN',
  'NOTA_DINAS',
  'PENGANTAR',
  'LAPORAN',
  'LAINNYA',
] as const;
export type LetterType = (typeof LETTER_TYPES)[number];

export const DISPOSITION_STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export type DispositionStatus = (typeof DISPOSITION_STATUSES)[number];

export const ASSIGNMENT_STATUSES = [
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING_REVIEW',
  'NEEDS_REVISION',
  'COMPLETED',
  'CANCELLED',
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const WORK_UPDATE_TYPES = [
  'STARTED',
  'PROGRESS',
  'SUBMITTED',
  'APPROVED',
  'REVISION_REQUESTED',
  'CANCELLED',
  'REASSIGNED',
] as const;
export type WorkUpdateType = (typeof WORK_UPDATE_TYPES)[number];

export const OUTGOING_TYPES = [
  'UNDANGAN',
  'TUGAS',
  'KETERANGAN',
  'NOTA_DINAS',
  'PENGANTAR',
] as const;
export type OutgoingType = (typeof OUTGOING_TYPES)[number];

export const OUTGOING_STATUSES = ['DRAFT', 'WAITING_REVIEW', 'NEEDS_REVISION', 'APPROVED', 'FINAL', 'CANCELLED'] as const;
export type OutgoingStatus = (typeof OUTGOING_STATUSES)[number];

export const JOB_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const AI_PROVIDERS = ['GEMINI', 'CLAUDE', 'TESSERACT'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const EXTRACTION_METHODS = ['LOCAL_TEXT', 'AI_TEXT', 'AI_VISION', 'LOCAL_OCR', 'MOCK'] as const;
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];

export const DOCUMENT_KINDS = ['SOURCE', 'ATTACHMENT', 'EVIDENCE', 'GENERATED', 'TEMPLATE'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const NOTIFICATION_TYPES = [
  'LETTER_FORWARDED',
  'DISPOSITION_ASSIGNED',
  'ASSIGNMENT_SUBMITTED',
  'REVISION_REQUESTED',
  'ASSIGNMENT_APPROVED',
  'ASSIGNMENT_CANCELLED',
  'DEADLINE_APPROACHING',
  'OVERDUE',
  'EXTRACTION_FINISHED',
  'EXTRACTION_FAILED',
  'OUTGOING_REVIEW_REQUESTED',
  'OUTGOING_REVIEWED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Fields of the AI extraction schema (PRD §9.3) that map onto letter metadata. */
export const EXTRACTION_FIELDS = [
  'document_type',
  'letter_number',
  'letter_date',
  'sender_name',
  'recipient_name',
  'subject',
  'attachment_text',
  'event_date',
  'event_location',
  'summary',
  'suggested_category',
] as const;
export type ExtractionField = (typeof EXTRACTION_FIELDS)[number];

/** Fields that must be checked by an officer before registration (PRD §9.4). */
export const REQUIRED_REVIEW_FIELDS: ExtractionField[] = [
  'letter_number',
  'letter_date',
  'sender_name',
  'recipient_name',
  'subject',
];
