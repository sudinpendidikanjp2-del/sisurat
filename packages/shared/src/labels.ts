import type {
  AssignmentStatus,
  Confidentiality,
  DispositionStatus,
  JobStatus,
  LetterStatus,
  LetterType,
  OutgoingStatus,
  OutgoingType,
  Priority,
  ProcessingStatus,
  WorkUpdateType,
  ExtractionMethod,
  ExtractionField,
} from './enums';

export const LETTER_STATUS_LABELS: Record<LetterStatus, string> = {
  DRAFT: 'Draft (belum terdaftar)',
  REGISTERED: 'Terdaftar',
  AWAITING_DISPOSITION: 'Menunggu disposisi',
  ASSIGNED: 'Ditugaskan',
  IN_PROGRESS: 'Dalam proses',
  WAITING_REVIEW: 'Menunggu pemeriksaan',
  NEEDS_REVISION: 'Perlu revisi',
  COMPLETED: 'Selesai',
  ARCHIVED: 'Diarsipkan',
  CANCELLED: 'Dibatalkan',
};

export const PROCESSING_STATUS_LABELS: Record<ProcessingStatus, string> = {
  UPLOADED: 'Diunggah',
  PROCESSING: 'Sedang diproses',
  NEEDS_REVIEW: 'Perlu ditinjau',
  PROCESSING_FAILED: 'Pemrosesan gagal',
  VERIFIED: 'Terverifikasi',
};

export const CONFIDENTIALITY_LABELS: Record<Confidentiality, string> = {
  BIASA: 'Biasa',
  TERBATAS: 'Terbatas',
  RAHASIA: 'Rahasia',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  RENDAH: 'Rendah',
  NORMAL: 'Normal',
  TINGGI: 'Tinggi',
  SEGERA: 'Segera',
};

export const LETTER_TYPE_LABELS: Record<LetterType, string> = {
  UNDANGAN: 'Undangan',
  PEMBERITAHUAN: 'Pemberitahuan',
  PERMOHONAN: 'Permohonan',
  EDARAN: 'Surat Edaran',
  TUGAS: 'Surat Tugas',
  KETERANGAN: 'Surat Keterangan',
  NOTA_DINAS: 'Nota Dinas',
  PENGANTAR: 'Surat Pengantar',
  LAPORAN: 'Laporan',
  LAINNYA: 'Lainnya',
};

export const DISPOSITION_STATUS_LABELS: Record<DispositionStatus, string> = {
  ACTIVE: 'Aktif',
  COMPLETED: 'Selesai',
  CANCELLED: 'Dibatalkan',
};

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  ASSIGNED: 'Ditugaskan',
  IN_PROGRESS: 'Dalam proses',
  WAITING_REVIEW: 'Menunggu pemeriksaan',
  NEEDS_REVISION: 'Perlu revisi',
  COMPLETED: 'Selesai',
  CANCELLED: 'Dibatalkan',
};

export const WORK_UPDATE_TYPE_LABELS: Record<WorkUpdateType, string> = {
  STARTED: 'Mulai dikerjakan',
  PROGRESS: 'Catatan progres',
  SUBMITTED: 'Diajukan untuk pemeriksaan',
  APPROVED: 'Disetujui',
  REVISION_REQUESTED: 'Diminta revisi',
  CANCELLED: 'Dibatalkan',
  REASSIGNED: 'Dialihkan',
};

export const OUTGOING_TYPE_LABELS: Record<OutgoingType, string> = {
  UNDANGAN: 'Surat Undangan',
  TUGAS: 'Surat Tugas',
  KETERANGAN: 'Surat Keterangan',
  NOTA_DINAS: 'Nota Dinas',
  PENGANTAR: 'Surat Pengantar',
};

export const OUTGOING_STATUS_LABELS: Record<OutgoingStatus, string> = {
  DRAFT: 'Draft',
  WAITING_REVIEW: 'Menunggu pemeriksaan',
  NEEDS_REVISION: 'Perlu revisi',
  APPROVED: 'Disetujui',
  FINAL: 'Final',
  CANCELLED: 'Dibatalkan',
};

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  QUEUED: 'Dalam antrean',
  RUNNING: 'Berjalan',
  SUCCEEDED: 'Berhasil',
  FAILED: 'Gagal',
  CANCELLED: 'Dibatalkan',
};

export const EXTRACTION_METHOD_LABELS: Record<ExtractionMethod, string> = {
  LOCAL_TEXT: 'Teks PDF lokal',
  AI_TEXT: 'AI (dari teks PDF)',
  AI_VISION: 'AI visual',
  LOCAL_OCR: 'OCR lokal (Tesseract)',
  MOCK: 'Provider uji',
};

export const EXTRACTION_FIELD_LABELS: Record<ExtractionField, string> = {
  document_type: 'Jenis surat',
  letter_number: 'Nomor surat',
  letter_date: 'Tanggal surat',
  sender_name: 'Instansi pengirim',
  recipient_name: 'Penerima',
  subject: 'Perihal',
  attachment_text: 'Lampiran',
  event_date: 'Tanggal kegiatan',
  event_location: 'Tempat kegiatan',
  summary: 'Ringkasan',
  suggested_category: 'Saran kategori',
};

export const REVIEW_FLAG_LABELS: Record<string, string> = {
  MISSING: 'Tidak ditemukan',
  AMBIGUOUS: 'Ambigu / tidak jelas',
  INVALID_FORMAT: 'Format tidak valid',
  CONFLICT: 'Hasil bertentangan',
  DUPLICATE_SUSPECT: 'Kemungkinan duplikat',
};
