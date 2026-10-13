import { useState } from 'react';
import type { UseFormRegister, FieldErrors } from 'react-hook-form';
import { Download, ExternalLink, FileText, ImageIcon } from 'lucide-react';
import { CONFIDENTIALITY_LABELS, CONFIDENTIALITY_LEVELS, LETTER_TYPES, LETTER_TYPE_LABELS, PRIORITIES, PRIORITY_LABELS } from '@sisurat/shared';
import { Field, Input, Select, Textarea } from '../../components/ui';
import { documentUrl } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import type { DocumentInfo } from '../../types/api';
import { cn } from '../../lib/cn';

/** Form values used by the upload, edit and verification forms (dates as YYYY-MM-DD strings). */
export interface LetterFormValues {
  letterType: string;
  letterNumber: string;
  letterDate: string;
  receivedDate: string;
  senderName: string;
  recipientName: string;
  subject: string;
  attachmentText: string;
  eventDate: string;
  eventLocation: string;
  summary: string;
  category: string;
  priority: string;
  confidentiality: string;
  notes: string;
}

export const emptyLetterForm: LetterFormValues = {
  letterType: '', letterNumber: '', letterDate: '', receivedDate: '', senderName: '', recipientName: '', subject: '',
  attachmentText: '', eventDate: '', eventLocation: '', summary: '', category: '', priority: 'NORMAL', confidentiality: 'BIASA', notes: '',
};

type FieldKey = keyof LetterFormValues;

interface Props {
  register: UseFormRegister<LetterFormValues>;
  errors: FieldErrors<LetterFormValues>;
  required?: FieldKey[];
  /** Extra content rendered under a field label (e.g. AI flag / evidence). */
  annotate?: (key: FieldKey) => React.ReactNode;
  hide?: FieldKey[];
}

export function LetterMetadataFields({ register, errors, required = [], annotate, hide = [] }: Props) {
  const req = (k: FieldKey) => required.includes(k);
  const show = (k: FieldKey) => !hide.includes(k);
  const hint = (k: FieldKey) => annotate?.(k);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {show('letterNumber') && (
        <Field label="Nomor surat (dari pengirim)" required={req('letterNumber')} error={errors.letterNumber?.message} hint={hint('letterNumber')}>
          <Input {...register('letterNumber')} />
        </Field>
      )}
      {show('letterType') && (
        <Field label="Jenis surat" error={errors.letterType?.message} hint={hint('letterType')}>
          <Select {...register('letterType')}>
            <option value="">— Pilih —</option>
            {LETTER_TYPES.map((t) => <option key={t} value={t}>{LETTER_TYPE_LABELS[t]}</option>)}
          </Select>
        </Field>
      )}
      {show('letterDate') && (
        <Field label="Tanggal surat" required={req('letterDate')} error={errors.letterDate?.message} hint={hint('letterDate')}>
          <Input type="date" {...register('letterDate')} />
        </Field>
      )}
      {show('receivedDate') && (
        <Field label="Tanggal diterima" required={req('receivedDate')} error={errors.receivedDate?.message} hint={hint('receivedDate')}>
          <Input type="date" {...register('receivedDate')} />
        </Field>
      )}
      {show('senderName') && (
        <Field label="Asal / instansi pengirim" required={req('senderName')} error={errors.senderName?.message} hint={hint('senderName')}>
          <Input {...register('senderName')} />
        </Field>
      )}
      {show('recipientName') && (
        <Field label="Tujuan / penerima" required={req('recipientName')} error={errors.recipientName?.message} hint={hint('recipientName')}>
          <Input {...register('recipientName')} />
        </Field>
      )}
      {show('subject') && (
        <Field label="Perihal" required={req('subject')} error={errors.subject?.message} hint={hint('subject')} className="sm:col-span-2">
          <Input {...register('subject')} />
        </Field>
      )}
      {show('attachmentText') && (
        <Field label="Keterangan lampiran" error={errors.attachmentText?.message} hint={hint('attachmentText')}>
          <Input {...register('attachmentText')} />
        </Field>
      )}
      {show('category') && (
        <Field label="Kategori / klasifikasi" error={errors.category?.message} hint={hint('category')}>
          <Input {...register('category')} />
        </Field>
      )}
      {show('eventDate') && (
        <Field label="Tanggal kegiatan" error={errors.eventDate?.message} hint={hint('eventDate')}>
          <Input type="date" {...register('eventDate')} />
        </Field>
      )}
      {show('eventLocation') && (
        <Field label="Tempat kegiatan" error={errors.eventLocation?.message} hint={hint('eventLocation')}>
          <Input {...register('eventLocation')} />
        </Field>
      )}
      {show('summary') && (
        <Field label="Ringkasan" error={errors.summary?.message} hint={hint('summary')} className="sm:col-span-2">
          <Textarea rows={3} {...register('summary')} />
        </Field>
      )}
      {show('priority') && (
        <Field label="Prioritas" error={errors.priority?.message}>
          <Select {...register('priority')}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </Select>
        </Field>
      )}
      {show('confidentiality') && (
        <Field label="Klasifikasi keamanan" error={errors.confidentiality?.message} hint="Surat Rahasia tidak dikirim ke AI eksternal kecuali diizinkan admin.">
          <Select {...register('confidentiality')}>
            {CONFIDENTIALITY_LEVELS.map((c) => <option key={c} value={c}>{CONFIDENTIALITY_LABELS[c]}</option>)}
          </Select>
        </Field>
      )}
      {show('notes') && (
        <Field label="Catatan internal" error={errors.notes?.message} className="sm:col-span-2">
          <Textarea rows={2} {...register('notes')} />
        </Field>
      )}
    </div>
  );
}

/** Converts form strings into the API payload (empty → null). */
export function toPayload(v: Partial<LetterFormValues>) {
  const out: Record<string, string | null> = {};
  for (const [k, val] of Object.entries(v)) out[k] = val === '' ? null : (val ?? null);
  return out;
}

/** Inline preview for PDFs/images through the authorised document endpoint. */
export function DocumentViewer({ documents, className }: { documents: DocumentInfo[]; className?: string }) {
  const [activeId, setActiveId] = useState(documents[0]?.id);
  const active = documents.find((d) => d.id === activeId) ?? documents[0];
  if (!active) {
    return <div className={cn('flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-sm text-slate-500', className)}>Tidak ada dokumen terlampir</div>;
  }
  const isImage = active.mimeType.startsWith('image/');
  const isPdf = active.mimeType === 'application/pdf';
  return (
    <div className={cn('flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white', className)}>
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 p-2">
        {documents.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setActiveId(d.id)}
            className={cn('flex max-w-[14rem] items-center gap-1 rounded px-2 py-1 text-xs', d.id === active.id ? 'bg-white font-medium shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white')}
            aria-pressed={d.id === active.id}
          >
            {d.mimeType.startsWith('image/') ? <ImageIcon className="h-3.5 w-3.5 shrink-0" /> : <FileText className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{d.originalName}</span>
          </button>
        ))}
        <a href={documentUrl(active.id)} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-xs text-brand-700 hover:bg-white">
          <ExternalLink className="h-3.5 w-3.5" /> Buka di tab baru
        </a>
        <a href={documentUrl(active.id, true)} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-brand-700 hover:bg-white" download>
          <Download className="h-3.5 w-3.5" /> Unduh ({formatBytes(active.sizeBytes)})
        </a>
      </div>
      <div className="min-h-[28rem] flex-1 bg-slate-100">
        {isPdf ? (
          <iframe key={active.id} src={documentUrl(active.id)} title={`Pratinjau ${active.originalName}`} className="h-full min-h-[28rem] w-full" />
        ) : isImage ? (
          <div className="flex h-full items-start justify-center overflow-auto p-2">
            <img src={documentUrl(active.id)} alt={`Pindaian ${active.originalName}`} className="max-w-full shadow" />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-sm text-slate-500">Pratinjau tidak tersedia. Silakan unduh berkas.</div>
        )}
      </div>
    </div>
  );
}
