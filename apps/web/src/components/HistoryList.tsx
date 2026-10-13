import { EXTRACTION_METHOD_LABELS, type ExtractionMethod } from '@sisurat/shared';
import { formatDateTime } from '../lib/format';
import type { HistoryItem } from '../types/api';

const LABELS: Record<string, string> = {
  'letter.created': 'Surat diunggah / dicatat',
  'letter.documents_added': 'Lampiran ditambahkan',
  'letter.updated': 'Metadata diubah',
  'letter.verified': 'Metadata diverifikasi & surat didaftarkan',
  'letter.forwarded': 'Diteruskan untuk disposisi',
  'letter.archived': 'Diarsipkan',
  'letter.cancelled': 'Dibatalkan',
  'letter.deleted': 'Draft dihapus',
  'extraction.requested': 'Ekstraksi diminta',
  'extraction.succeeded': 'Ekstraksi selesai',
  'extraction.failed': 'Ekstraksi gagal',
  'extraction.retry_scheduled': 'Ekstraksi dijadwalkan ulang',
  'disposition.created': 'Disposisi diberikan',
  'disposition.cancelled': 'Disposisi dibatalkan',
  'assignment.started': 'Tugas mulai dikerjakan',
  'assignment.progress': 'Progres diperbarui',
  'assignment.submitted': 'Hasil diajukan untuk pemeriksaan',
  'assignment.approved': 'Hasil disetujui',
  'assignment.revision_requested': 'Diminta revisi',
  'assignment.cancelled': 'Tugas dibatalkan',
  'assignment.reassigned': 'Tugas dialihkan',
  'outgoing.created': 'Draft surat keluar dibuat',
  'outgoing.updated': 'Draft surat keluar diubah',
  'outgoing.submitted': 'Diajukan untuk pemeriksaan',
  'outgoing.approved': 'Disetujui',
  'outgoing.revision_requested': 'Diminta revisi',
  'outgoing.finalized': 'Difinalkan & diberi nomor',
  'outgoing.cancelled': 'Dibatalkan',
  'document.viewed': 'Dokumen dilihat',
  'document.downloaded': 'Dokumen diunduh',
};

export function actionLabel(action: string) {
  if (action.startsWith('method.')) return EXTRACTION_METHOD_LABELS[action.slice(7) as ExtractionMethod] ?? action;
  return LABELS[action] ?? action;
}

function summarize(obj: Record<string, unknown> | null) {
  if (!obj) return null;
  const entries = Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object');
  if (!entries.length) return null;
  return entries.map(([k, v]) => `${k}: ${String(v)}`).join(' · ');
}

export function HistoryList({ items }: { items: HistoryItem[] }) {
  if (!items.length) return <p className="py-6 text-center text-sm text-slate-500">Belum ada riwayat.</p>;
  return (
    <ol className="relative space-y-4 border-l border-slate-200 pl-5">
      {items.map((h) => (
        <li key={h.id} className="relative">
          <span className="absolute top-1.5 -left-[25px] h-2.5 w-2.5 rounded-full bg-brand-600 ring-4 ring-white" aria-hidden />
          <p className="text-sm font-medium text-slate-800">{actionLabel(h.action)}</p>
          <p className="text-xs text-slate-500">
            {h.actor?.fullName ?? 'Sistem'} · {formatDateTime(h.createdAt)}
          </p>
          {summarize(h.after) && <p className="mt-1 text-xs break-words text-slate-600">{summarize(h.after)}</p>}
        </li>
      ))}
    </ol>
  );
}
