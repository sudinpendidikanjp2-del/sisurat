import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FileUp, Trash2, UploadCloud } from 'lucide-react';
import { api, ApiError, newIdempotencyKey } from '../../lib/api';
import { formatBytes, todayIso } from '../../lib/format';
import { Alert, Button, Card, Checkbox, PageHeader, useToast } from '../../components/ui';
import { LetterMetadataFields, emptyLetterForm, toPayload, type LetterFormValues } from './components';

interface PublicSettings {
  maxUploadMb: number;
  maxPdfPages: number;
  maxFilesPerLetter: number;
  autoExtractOnUpload: boolean;
  aiEnabled: boolean;
}

const ACCEPT = ['application/pdf', 'image/jpeg', 'image/png'];

export function LetterUploadPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [autoExtract, setAutoExtract] = useState<boolean | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // One key per form session: a retried submit cannot create a second letter.
  const idemKey = useMemo(() => newIdempotencyKey(), []);
  const settings = useQuery({ queryKey: ['settings', 'public'], queryFn: () => api.get<PublicSettings>('/settings/public') });
  const s = settings.data;
  const extract = autoExtract ?? s?.autoExtractOnUpload ?? true;

  const form = useForm<LetterFormValues>({ defaultValues: { ...emptyLetterForm, receivedDate: todayIso() } });

  const addFiles = (list: FileList | File[]) => {
    setFileError(null);
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!ACCEPT.includes(f.type)) {
        setFileError(`"${f.name}" bukan PDF, JPEG, atau PNG.`);
        continue;
      }
      if (s && f.size > s.maxUploadMb * 1024 * 1024) {
        setFileError(`"${f.name}" melebihi batas ${s.maxUploadMb} MB.`);
        continue;
      }
      next.push(f);
    }
    if (s && next.length > s.maxFilesPerLetter) {
      setFileError(`Maksimal ${s.maxFilesPerLetter} berkas per surat.`);
      return;
    }
    setFiles(next);
  };

  const mutation = useMutation({
    mutationFn: async (values: LetterFormValues) => {
      const fd = new FormData();
      const meta = manual ? toPayload(values) : toPayload({ receivedDate: values.receivedDate, priority: values.priority, confidentiality: values.confidentiality, letterType: values.letterType });
      fd.append('metadata', JSON.stringify({ ...meta, autoExtract: files.length > 0 && extract }));
      for (const f of files) fd.append('files', f, f.name);
      return api.post<{ id: string; jobId: string | null }>('/incoming-letters', fd, { 'Idempotency-Key': idemKey });
    },
    onSuccess: (res) => {
      toast.success(res.jobId ? 'Surat diunggah. Ekstraksi metadata sedang diproses.' : 'Surat dicatat sebagai draft.');
      navigate(`/surat-masuk/${res.id}/verifikasi`);
    },
    onError: (e) => toast.error(e),
  });

  const onSubmit = form.handleSubmit((v) => {
    if (files.length === 0 && !v.subject.trim()) {
      setManual(true);
      form.setError('subject', { message: 'Unggah dokumen atau isi perihal untuk pencatatan manual' });
      return;
    }
    mutation.mutate(v);
  });

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Unggah surat masuk"
        description="Dokumen asli disimpan privat. Hasil OCR/AI selalu menjadi draft dan harus diverifikasi petugas sebelum terdaftar."
        breadcrumbs={[{ label: 'Beranda', to: '/' }, { label: 'Surat Masuk', to: '/surat-masuk' }, { label: 'Unggah' }]}
      />
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Card title="Dokumen surat">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              addFiles(e.dataTransfer.files);
            }}
            className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center ${dragOver ? 'border-brand-500 bg-brand-50' : 'border-slate-300'}`}
          >
            <UploadCloud className="h-10 w-10 text-slate-400" aria-hidden />
            <p className="text-sm text-slate-700">Seret berkas ke sini atau</p>
            <Button variant="secondary" onClick={() => inputRef.current?.click()}>
              <FileUp className="h-4 w-4" /> Pilih berkas
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png"
              className="sr-only"
              aria-label="Pilih berkas surat"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <p className="text-xs text-slate-500">
              PDF, JPEG, atau PNG · maks. {s?.maxUploadMb ?? '…'} MB per berkas · maks. {s?.maxPdfPages ?? '…'} halaman · berkas pertama menjadi dokumen sumber
            </p>
          </div>
          {fileError && <div className="mt-3"><Alert tone="error">{fileError}</Alert></div>}
          {files.length > 0 && (
            <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="truncate">
                    {i === 0 && <span className="mr-1 rounded bg-brand-50 px-1.5 text-xs text-brand-700">Sumber</span>}
                    {f.name} <span className="text-xs text-slate-500">({formatBytes(f.size)})</span>
                  </span>
                  <button type="button" className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-600" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Hapus ${f.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-col gap-2">
            <Checkbox
              label="Proses otomatis (ekstraksi teks PDF / OCR / AI sesuai kebijakan)"
              checked={extract}
              disabled={files.length === 0}
              onChange={(e) => setAutoExtract(e.target.checked)}
            />
            {s && !s.aiEnabled && (
              <p className="text-xs text-slate-500">
                AI eksternal belum diaktifkan. PDF digital tetap dibaca secara lokal; dokumen hasil scan dapat diisi manual.
              </p>
            )}
          </div>
        </Card>

        <Card
          title="Metadata"
          actions={<Checkbox label="Isi metadata manual sekarang" checked={manual} onChange={(e) => setManual(e.target.checked)} />}
        >
          {manual ? (
            <LetterMetadataFields register={form.register} errors={form.formState.errors} />
          ) : (
            <LetterMetadataFields
              register={form.register}
              errors={form.formState.errors}
              hide={['letterNumber', 'letterDate', 'senderName', 'recipientName', 'subject', 'attachmentText', 'category', 'eventDate', 'eventLocation', 'summary', 'notes']}
            />
          )}
          {!manual && <p className="mt-3 text-xs text-slate-500">Field lainnya diisi pada halaman verifikasi, dari hasil ekstraksi atau secara manual.</p>}
        </Card>

        {mutation.error instanceof ApiError && <Alert tone="error">{mutation.error.message}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => navigate('/surat-masuk')}>
            Batal
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Simpan & lanjut verifikasi
          </Button>
        </div>
      </form>
    </div>
  );
}
