import type {
  AssignmentStatus,
  Confidentiality,
  LetterStatus,
  LetterType,
  OutgoingStatus,
  OutgoingType,
  Priority,
  ProcessingStatus,
  NormalizedFields,
  ReviewFlag,
  Evidence,
  PlaceholderDef,
  WorkUpdateType,
  DispositionStatus,
  JobStatus,
  ExtractionMethod,
  AiProvider,
} from '@sisurat/shared';

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export interface Paged<T> {
  items: T[];
  meta: PageMeta;
}
export interface UserRef {
  id: string;
  fullName: string;
  position?: string | null;
}
export interface Me {
  id: string;
  username: string;
  fullName: string;
  position: string | null;
  roles: string[];
  permissions: string[];
  mustChangePassword: boolean;
}
export interface DocumentInfo {
  id: string;
  kind: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  checksumSha256: string;
  createdAt: string;
  version?: number;
  uploadedBy: UserRef;
}
export interface LetterListItem {
  id: string;
  agendaNumber: string | null;
  letterNumber: string | null;
  letterDate: string | null;
  receivedDate: string;
  senderName: string | null;
  recipientName: string | null;
  subject: string | null;
  letterType: LetterType | null;
  summary: string | null;
  priority: Priority;
  confidentiality: Confidentiality;
  status: LetterStatus;
  processingStatus: ProcessingStatus;
  createdAt: string;
  createdBy: UserRef;
  forwardedTo: UserRef | null;
  documentCount: number;
  assignees: UserRef[];
  dueDate: string | null;
}
export interface ExtractionJobInfo {
  id: string;
  status: JobStatus;
  method: ExtractionMethod | null;
  provider: AiProvider | null;
  requestedProvider: AiProvider | null;
  model: string | null;
  promptVersion: string | null;
  attempts: number;
  maxAttempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  documentId: string;
  createdAt: string;
  finishedAt: string | null;
  requestedBy: UserRef | null;
  result: {
    id: string;
    normalizedFields: NormalizedFields;
    reviewFlags: ReviewFlag[];
    evidence: Evidence[];
    reviewedAt: string | null;
    extractedTextChars: number | null;
  } | null;
}
export interface WorkUpdateInfo {
  id: string;
  type: WorkUpdateType;
  note: string | null;
  progressPercent: number | null;
  createdAt: string;
  author: UserRef;
  attachments: DocumentInfo[];
}
export interface AssignmentInfo {
  id: string;
  status: AssignmentStatus;
  progressPercent: number;
  dueDate: string | null;
  assignee: UserRef;
  updates: WorkUpdateInfo[];
  createdAt: string;
  completedAt: string | null;
  cancelReason: string | null;
}
export interface DispositionInfo {
  id: string;
  instruction: string;
  priority: Priority;
  dueDate: string | null;
  status: DispositionStatus;
  cancelReason: string | null;
  createdAt: string;
  issuer: UserRef;
  assignments: AssignmentInfo[];
}
export interface LetterActions {
  edit: boolean;
  extract: boolean;
  verify: boolean;
  addDocuments: boolean;
  forward: boolean;
  dispose: boolean;
  archive: boolean;
  cancel: boolean;
  createReply: boolean;
  activeDispositions: number;
}
export interface LetterDetail extends Omit<LetterListItem, 'documentCount' | 'assignees' | 'dueDate'> {
  attachmentText: string | null;
  eventDate: string | null;
  eventLocation: string | null;
  category: string | null;
  notes: string | null;
  verifiedAt: string | null;
  verifiedBy: UserRef | null;
  registeredAt: string | null;
  forwardedAt: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  documents: DocumentInfo[];
  extractionJobs: ExtractionJobInfo[];
  dispositions: DispositionInfo[];
  corrections: { id: string; field: string; previousValue: string | null; newValue: string | null; source: string; createdAt: string; correctedBy: UserRef }[];
  outgoingLinks: { outgoingLetter: { id: string; number: string | null; subject: string; status: OutgoingStatus; type: OutgoingType } }[];
  actions: LetterActions;
}
export interface HistoryItem {
  id: string;
  action: string;
  entityType: string;
  summary: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
  actor: UserRef | null;
}
export interface TemplateInfo {
  id: string;
  type: OutgoingType;
  name: string;
  version: number;
  isActive: boolean;
  isSample: boolean;
  placeholders: PlaceholderDef[];
  activeFrom: string | null;
  approvedByName: string | null;
  createdAt: string;
  createdBy: UserRef;
  file: DocumentInfo | null;
  _count?: { outgoingLetters: number };
}
export interface NotificationInfo {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}
