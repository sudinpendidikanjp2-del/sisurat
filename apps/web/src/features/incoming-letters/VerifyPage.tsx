import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { AlertTriangle, Bot, CheckCircle2, Loader2, Quote, RefreshCw } from 'lucide-react';
import { EXTRACTION_METHOD_LABELS, REVIEW_FLAG_LABELS, letterVerifySchema, type ReviewFlag, type Evidence, type NormalizedFields } from '@sisurat/shared';
import { api, ApiError } from '../../lib/api';
import { formatDate, formatDateTime, toInputDate, todayIso } from '../../lib/format';
import type { ExtractionJobInfo, LetterDetail } from '../../types/api';
import { Alert, Badge, Button, Card, Checkbox, ErrorState, PageHeader, Select, Spinner, StatusBadge, useToast } from '../../components/ui';
import { useAuth } from '../auth/AuthContext';
import { DocumentViewer, LetterMetadataFields, emptyLetterForm, toPayload, type LetterFormValues } from './components';

/** Form field → extraction schema field. */
const FIELD_TO_AI: Partial<Record<keyof LetterFormValues, keyof NormalizedFields>> = {
  letterType: 'document_type',
  letterNumber: 'letter_number',
  letterDate: 'letter_date',
  senderName: 'sender_name',
  recipientName: 'recipient_name',
  subject: 'subject',
  attachmentText: 'attachment_text',
  eventDate: 'event_date',
  eventLocation: 'event_location',
  summary: 'summary',
  category: 'suggested_category',
};

const REQUIRED: (keyof LetterFormValues)[] = ['letterNumber', 'letterDate', 'receivedDate', 'senderName', 'recipientName', 'subject'];

interface Duplicate {
  id: string;
  agendaNumber: string | null;
  subject: string | null;
  receivedDate: string;
}

function buildDefaults(l: LetterDetail, ai: NormalizedFields | null): LetterFormValues {
  // Values already typed by the officer win; AI values only pre-fill empty fields.
  const pick = (own: string | null | undefined, aiKey: keyof NormalizedFields) => own ?? (ai?.[aiKey] as string | null) ?? '';
  return {
    ...emptyLetterForm,
    letterType: pick(l.letterType, 'document_type'),
    letterNumber: pick(l.letterNumber, 'letter_number'),
    letterDate: toInputDate(pick(l.letterDate, 'letter_date')),
    receivedDate: toInputDate(l.receivedDate) || todayIso(),
    senderName: pick(l.senderName, 'sender_name'),
    recipientName: pick(l.recipientName, 'recipient_name'),
    subject: pick(l.subject, 'subject'),
    attachmentText: pick(l.attachmentText, 'attachment_text'),
    eventDate: toInputDate(pick(l.eventDate, 'event_date')),
    eventLocation: pick(l.eventLocation, 'event_location'),
    summary: pick(l.summary, 'summary'),
    category: pick(l.category, 'suggested_category'),
    priority: l.priority,
    confidentiality: l.confidentiality,
    notes: l.notes ?? '',
  };
}

function JobStatusCard({ job, letter, onRetry, retrying }: { job: ExtractionJobInfo | undefined; letter: LetterDetail; onRetry: (provider?: string) => void; retrying: boolean }) {
  const { can } = useAuth();
  const [provider, setProvider] = useState('');
  const running = job && (job.status === 'QUEUED' || job.status === 'RUNNING');
  return (
    <Card title={<span className="flex items-center gap-2"><Bot className="h-4 w-4" /> Hasil OCR / AI</span>}>
      {!job ? (
        <p className="text-sm text-slate-600">Belum ada proses ekstraksi. Isi metadata secara manual, atau jalankan ekstraksi untuk dokumen sumber.</p>
      ) : running ? (
        <div className="flex items-center gap-2 text-sm text-blue-800" role="status">
          <Loader2 className="h-4 w-4 animate-spin" />
          {job.status === 'QUEUED' ? (job.errorCode ? `Menunggu percobaan ulang (${job.attempts}/${job.maxAttempts}) setelah ${job.errorCode}…` : 'Dalam antrean…') : 'Sedang diproses…'}
          <span className="text-xs text-slate-500">Anda tetap dapat mengisi formulir secara manual.</span>
        </div>
      ) : job.status === 'FAILED' ? (
        <Alert tone="error" title="Pemrosesan gagal">
          {job.errorMessage ?? job.errorCode}
          <p className="mt-1 text-xs">Dokumen sumber tetap tersimpan. Coba lagi atau isi metadata secara manual.</p>
        </Alert>
      ) : (
        <div className="space-y-1 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>Draft dari <strong>{job.method ? EXTRACTION_METHOD_LABELS[job.method] : '-'}</strong></span>
            {job.provider && <Badge tone="indigo">{job.provider}{job.model ? ` · ${job.model}` : ''}</Badge>}
          </p>
          <p className="text-xs text-slate-500">{formatDateTime(job.finishedAt)} · Nilai berikut adalah usulan dan wajib diperiksa terhadap dokumen asli.</p>
        </div>
      )}
      {letter.actions.extract && letter.documents.length > 0 && can('extraction.run') && !running && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
          <Select value={provider} onChange={(e) => setProvider(e.target.value)} className="w-auto" aria-label="Provider ekstraksi">
            <option value="">Provider default (sesuai kebijakan)</option>
            <option value="GEMINI">Gemini</option>
            <option value="CLAUDE">Claude (alternatif)</option>
          </Select>
          <Button variant="secondary" size="sm" loading={retrying} onClick={() => onRetry(provider || undefined)}>
            <RefreshCw className="h-4 w-4" /> {job ? 'Proses ulang' : 'Jalankan ekstraksi'}
          </Button>
          <p className="w-full text-xs text-slate-500">Provider hanya dipakai bila diaktifkan dan disetujui admin untuk klasifikasi surat ini.</p>
        </div>
      )}
    </Card>
  );
}

export function VerifyPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [duplicates, setDuplicates] = useState<Duplicate[] | null>(null);
  const [confirmDup, setConfirmDup] = useState(false);

  const q = useQuery({
    queryKey: ['letter', id],
    queryFn: () => api.get<LetterDetail>(`/incoming-letters/${id}`),
    // Poll while a job is pending so the draft appears without reloading.
    refetchInterval: (query) => {
      const job = query.state.data?.extractionJobs[0];
      return job && (job.status === 'QUEUED' || job.status === 'RUNNING') ? 3000 : false;
    },
  });
  const letter = q.data;
  const job = letter?.extractionJobs[0];
  const result = job?.status === 'SUCCEEDED' ? job.result : null;
  const ai = result?.normalizedFields ?? null;

  const form = useForm<LetterFormValues>({ defaultValues: emptyLetterForm });
  const resultId = result?.id;
  useEffect(() => {
    if (letter) form.reset(buildDefaults(letter, ai));
    // reset only when the letter loads or a new extraction result arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letter?.id, resultId]);

  const flagsByField = useMemo(() => {
    const map = new Map<string, ReviewFlag[]>();
    for (const f of result?.reviewFlags ?? []) map.set(f.field, [...(map.get(f.field) ?? []), f]);
    return map;
  }, [result]);
  const evidenceByField = useMemo(() => {
    const map = new Map<string, Evidence>();
    for (const e of result?.evidence ?? []) if (!map.has(e.field)) map.set(e.field, e);
    return map;
  }, [result]);

  const retry = useMutation({
    mutationFn: (provider?: string) => api.post(`/documents/${letter!.documents.find((d) => d.kind === 'SOURCE')?.id ?? letter!.documents[0].id}/extract`, provider ? { provider } : {}),
    onSuccess: () => { toast.info('Ekstraksi dijadwalkan'); qc.invalidateQueries({ queryKey: ['letter', id] }); },
    onError: (e) => toast.error(e),
  });

  const verify = useMutation({
    mutationFn: (v: LetterFormValues) => api.post<{ agendaNumber: string }>(`/incoming-letters/${id}/verify`, { ...toPayload(v), extractionResultId: result?.id ?? null, confirmNotDuplicate: confirmDup }),
    onSuccess: (res) => {
      toast.success(`Surat terdaftar dengan nomor agenda ${res.agendaNumber}`);
      qc.invalidateQueries({ queryKey: ['letters'] });
      qc.invalidateQueries({ queryKey: ['letter', id] });
      navigate(`/surat-masuk/${id}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409 && (e.details as { duplicates?: Duplicate[] })?.duplicates) {
        setDuplicates((e.details as { duplicates: Duplicate[] }).duplicates);
        return;
      }
      if (e instanceof ApiError) {
        for (const [path, message] of Object.entries(e.fieldErrors)) form.setError(path as keyof LetterFormValues, { message });
      }
      toast.error(e);
    },
  });

  const onSubmit = form.handleSubmit((v) => {
    const parsed = letterVerifySchema.safeParse({ ...toPayload(v) });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) form.setError(issue.path[0] as keyof LetterFormValues, { message: issue.message });
      return;
    }
    verify.mutate(v);
  });

  if (q.isLoading) return <Spinner />;
  if (q.isError || !letter) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (letter.status !== 'DRAFT') {
    return (
      <div className="space-y-4">
        <PageHeader title="Verifikasi metadata" breadcrumbs={[{ label: 'Surat Masuk', to: '/surat-masuk' }, { label: letter.agendaNumber ?? '' }]} />
        <Alert tone="success" title="Surat sudah terdaftar">Nomor agenda {letter.agendaNumber}. <button className="underline" onClick={() => navigate(`/surat-masuk/${id}`)}>Buka detail</button></Alert>
      </div>
    );
  }

  const annotate = (key: keyof LetterFormValues) => {
    const aiKey = FIELD_TO_AI[key];
    if (!aiKey || !result) return null;
    const flags = flagsByField.get(aiKey) ?? [];
    const ev = evidenceByField.get(aiKey);
    const aiValue = ai?.[aiKey];
    const rawDate = key === 'letterDate' ? ai?.letter_date_raw : key === 'eventDate' ? ai?.event_date_raw : null;
    if (!flags.length && !ev && !aiValue) return null;
    return (
      <span className="flex flex-col gap-1">
        {flags.map((f, i) => (
          <span key={i} className="inline-flex items-center gap-1 text-amber-700">
            <AlertTriangle className="h-3 w-3" /> {REVIEW_FLAG_LABELS[f.code] ?? f.code}{f.message ? `: ${f.message}` : ''}
          </span>
        ))}
        {aiValue && <span className="text-slate-500">Usulan: {key.endsWith('Date') ? formatDate(aiValue) : aiValue}{rawDate ? ` (tertulis "${rawDate}")` : ''}</span>}
        {ev?.quote && (
          <span className="inline-flex items-start gap-1 text-slate-500 italic">
            <Quote className="mt-0.5 h-3 w-3 shrink-0" /> “{ev.quote}”{ev.page ? ` — hlm. ${ev.page}` : ''}
          </span>
        )}
      </span>
    );
  };

  return (
    <div>
      <PageHeader
        title="Verifikasi metadata surat"
        description="Bandingkan setiap field dengan dokumen asli, perbaiki bila perlu, lalu daftarkan. Hanya data yang Anda konfirmasi yang masuk register."
        breadcrumbs={[{ label: 'Beranda', to: '/' }, { label: 'Surat Masuk', to: '/surat-masuk' }, { label: 'Detail', to: `/surat-masuk/${id}` }, { label: 'Verifikasi' }]}
        actions={<span className="flex items-center gap-2"><StatusBadge kind="processing" value={letter.processingStatus} /><StatusBadge kind="confidentiality" value={letter.confidentiality} /></span>}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <DocumentViewer documents={letter.documents} className="xl:sticky xl:top-20 xl:h-[calc(100vh-7rem)]" />
        <div className="space-y-4">
          <JobStatusCard job={job} letter={letter} onRetry={(p) => retry.mutate(p)} retrying={retry.isPending} />
          {result && result.reviewFlags.length > 0 && (
            <Alert tone="warning" title={`${result.reviewFlags.length} hal perlu diperhatikan`}>
              Field bertanda peringatan kosong, ambigu, berformat tidak valid, bertentangan, atau mungkin duplikat. Indikator ini bukan skor akurasi.
            </Alert>
          )}
          <Card title="Metadata final">
            <form onSubmit={onSubmit} noValidate className="space-y-4">
              <LetterMetadataFields register={form.register} errors={form.formState.errors} required={REQUIRED} annotate={annotate} />
              {duplicates && (
                <Alert tone="warning" title="Kemungkinan surat ganda">
                  <ul className="mt-1 list-disc pl-4">
                    {duplicates.map((d) => (
                      <li key={d.id}>
                        <a href={`/surat-masuk/${d.id}`} target="_blank" rel="noreferrer" className="underline">{d.agendaNumber ?? 'Draft'}</a> — {d.subject} ({formatDate(d.receivedDate)})
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2"><Checkbox label="Saya sudah memeriksa; ini bukan surat ganda" checked={confirmDup} onChange={(e) => setConfirmDup(e.target.checked)} /></div>
                </Alert>
              )}
              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
                <Button variant="secondary" onClick={() => navigate(`/surat-masuk/${id}`)}>Nanti saja</Button>
                <Button type="submit" variant="success" loading={verify.isPending} disabled={!!duplicates && !confirmDup}>
                  <CheckCircle2 className="h-4 w-4" /> Konfirmasi & daftarkan
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
