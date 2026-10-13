import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ShieldAlert } from 'lucide-react';
import { AI_PROVIDERS, CONFIDENTIALITY_LABELS, CONFIDENTIALITY_LEVELS, appSettingsSchema, type AppSettings, type Confidentiality } from '@sisurat/shared';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { Alert, Badge, Button, Card, Checkbox, ErrorState, Field, Input, PageHeader, Select, Spinner, Textarea, useToast } from '../../components/ui';

interface ProviderRow {
  provider: 'GEMINI' | 'CLAUDE' | 'TESSERACT';
  enabled: boolean;
  model: string;
  approvedForExternal: boolean;
  allowedConfidentiality: Confidentiality[];
  timeoutMs: number;
  maxAttempts: number;
  inputCostPerMTokUsd: number | null;
  outputCostPerMTokUsd: number | null;
  notes: string | null;
  updatedAt: string;
  external: boolean;
  credentialConfigured: boolean;
}

const PROVIDER_INFO: Record<ProviderRow['provider'], { name: string; desc: string }> = {
  GEMINI: { name: 'Gemini API', desc: 'Kandidat provider utama untuk pembacaan dokumen visual dan ekstraksi metadata.' },
  CLAUDE: { name: 'Claude API', desc: 'Provider alternatif untuk pembandingan atau dokumen sulit. Tidak dipakai otomatis sebagai fallback.' },
  TESSERACT: { name: 'Tesseract OCR (lokal)', desc: 'OCR di server sendiri; dokumen tidak dikirim keluar. Kualitas perlu diuji pada surat kantor.' },
};

function ProviderCard({ p }: { p: ProviderRow }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState(p);
  useEffect(() => setV(p), [p]);
  const m = useMutation({
    mutationFn: () => {
      const { provider: _p, updatedAt: _u, external: _e, credentialConfigured: _c, ...body } = v;
      return api.put(`/ai-providers/${p.provider}`, body);
    },
    onSuccess: () => { toast.success(`${PROVIDER_INFO[p.provider].name} disimpan`); qc.invalidateQueries({ queryKey: ['ai-providers'] }); },
    onError: (e) => toast.error(e),
  });
  const info = PROVIDER_INFO[p.provider];
  return (
    <Card
      title={<span className="flex flex-wrap items-center gap-2">{info.name} {v.enabled ? <Badge tone="green">Aktif</Badge> : <Badge>Nonaktif</Badge>} {p.external && (v.approvedForExternal ? <Badge tone="blue">Disetujui</Badge> : <Badge tone="yellow">Belum disetujui</Badge>)}</span>}
      actions={<Badge tone={p.credentialConfigured ? 'green' : 'red'}>{p.provider === 'TESSERACT' ? (p.credentialConfigured ? 'Terpasang' : 'Tidak terpasang') : p.credentialConfigured ? 'API key tersedia' : 'API key belum diatur'}</Badge>}
    >
      <p className="mb-3 text-xs text-slate-500">{info.desc}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Model" hint="Periksa nama model terbaru di dokumentasi resmi provider."><Input value={v.model} onChange={(e) => setV({ ...v, model: e.target.value })} disabled={p.provider === 'TESSERACT'} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Timeout (ms)"><Input type="number" value={v.timeoutMs} onChange={(e) => setV({ ...v, timeoutMs: Number(e.target.value) })} /></Field>
          <Field label="Maks. percobaan"><Input type="number" min={1} max={10} value={v.maxAttempts} onChange={(e) => setV({ ...v, maxAttempts: Number(e.target.value) })} /></Field>
        </div>
        {p.external && (
          <div className="grid grid-cols-2 gap-2 sm:col-span-2">
            <Field label="Tarif input (US$/1 juta token)" hint="Diisi dari halaman harga resmi; dipakai untuk estimasi biaya."><Input type="number" step="0.0001" value={v.inputCostPerMTokUsd ?? ''} onChange={(e) => setV({ ...v, inputCostPerMTokUsd: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
            <Field label="Tarif output (US$/1 juta token)"><Input type="number" step="0.0001" value={v.outputCostPerMTokUsd ?? ''} onChange={(e) => setV({ ...v, outputCostPerMTokUsd: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
          </div>
        )}
        <div className="space-y-2 sm:col-span-2">
          <Checkbox label="Aktifkan provider" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} />
          {p.external && (
            <>
              <Checkbox label="Organisasi telah meninjau ketentuan data (retensi, pelatihan, subprosesor, lokasi, tier) dan menyetujui pengiriman dokumen" checked={v.approvedForExternal} onChange={(e) => setV({ ...v, approvedForExternal: e.target.checked })} />
              <fieldset>
                <legend className="text-sm font-medium text-slate-700">Klasifikasi surat yang boleh dikirim</legend>
                <div className="mt-1 flex flex-wrap gap-4">
                  {CONFIDENTIALITY_LEVELS.map((c) => (
                    <Checkbox key={c} label={CONFIDENTIALITY_LABELS[c]} checked={v.allowedConfidentiality.includes(c)} onChange={(e) => setV({ ...v, allowedConfidentiality: e.target.checked ? [...v.allowedConfidentiality, c] : v.allowedConfidentiality.filter((x) => x !== c) })} />
                  ))}
                </div>
              </fieldset>
            </>
          )}
        </div>
        <Field label="Catatan kebijakan" className="sm:col-span-2"><Textarea rows={2} value={v.notes ?? ''} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-slate-400">Diubah {formatDateTime(p.updatedAt)}</span>
        <Button size="sm" loading={m.isPending} onClick={() => m.mutate()}>Simpan</Button>
      </div>
    </Card>
  );
}

export function ConfigPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: ['settings', 'admin'], queryFn: () => api.get<AppSettings>('/settings') });
  const providers = useQuery({ queryKey: ['ai-providers'], queryFn: () => api.get<{ items: ProviderRow[] }>('/ai-providers') });
  const form = useForm<AppSettings>({ resolver: zodResolver(appSettingsSchema) as never, values: settings.data });
  const save = useMutation({
    mutationFn: (v: AppSettings) => api.put('/settings', v),
    onSuccess: () => { toast.success('Konfigurasi disimpan'); qc.invalidateQueries({ queryKey: ['settings'] }); },
    onError: (e) => toast.error(e),
  });
  const e = form.formState.errors;
  if (settings.isLoading) return <Spinner />;
  if (settings.isError) return <ErrorState error={settings.error} />;
  return (
    <div>
      <PageHeader title="Konfigurasi Aplikasi & AI" description="Pengaturan penomoran, batas unggah, dan kebijakan pemrosesan dokumen." breadcrumbs={[{ label: 'Administrasi' }, { label: 'Konfigurasi' }]} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Pengaturan umum">
          <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
            <Field label="Nama instansi" className="sm:col-span-2" error={e.organizationName?.message}><Input {...form.register('organizationName')} /></Field>
            <Field label="Format nomor agenda" error={e.agendaNumberFormat?.message} hint="Token: {seq:4} {yyyy} {yy} {mm} {roman_month}"><Input {...form.register('agendaNumberFormat')} /></Field>
            <Field label="Format nomor surat keluar" error={e.outgoingNumberFormat?.message} hint="Token tambahan: {code} (kode jenis surat)"><Input {...form.register('outgoingNumberFormat')} /></Field>
            <Field label="Maks. ukuran berkas (MB)" error={e.maxUploadMb?.message}><Input type="number" {...form.register('maxUploadMb')} /></Field>
            <Field label="Maks. halaman PDF" error={e.maxPdfPages?.message}><Input type="number" {...form.register('maxPdfPages')} /></Field>
            <Field label="Maks. berkas per surat" error={e.maxFilesPerLetter?.message}><Input type="number" {...form.register('maxFilesPerLetter')} /></Field>
            <Field label="Pengingat tenggat (hari sebelum)" error={e.deadlineReminderDays?.message}><Input type="number" {...form.register('deadlineReminderDays')} /></Field>
            <Field label="Retensi hasil mentah AI (hari, 0 = simpan)" error={e.rawResultRetentionDays?.message}><Input type="number" {...form.register('rawResultRetentionDays')} /></Field>
            <Field label="Min. karakter teks per halaman (PDF digital)" error={e.minTextCharsPerPage?.message} hint="Di bawah nilai ini PDF dianggap hasil scan."><Input type="number" {...form.register('minTextCharsPerPage')} /></Field>
            <div className="space-y-3 rounded-md border border-slate-200 p-3 sm:col-span-2">
              <p className="flex items-center gap-2 text-sm font-medium"><ShieldAlert className="h-4 w-4 text-amber-600" /> Kebijakan AI</p>
              <Controller control={form.control} name="aiEnabled" render={({ field }) => <Checkbox label="Izinkan pemrosesan AI eksternal (hanya provider yang disetujui)" checked={!!field.value} onChange={(ev) => field.onChange(ev.target.checked)} />} />
              <Controller control={form.control} name="autoExtractOnUpload" render={({ field }) => <Checkbox label="Jalankan ekstraksi otomatis saat unggah" checked={!!field.value} onChange={(ev) => field.onChange(ev.target.checked)} />} />
              <Controller control={form.control} name="useAiForDigitalText" render={({ field }) => <Checkbox label="Gunakan AI juga untuk PDF digital (kirim teks hasil ekstraksi, bukan berkas)" checked={!!field.value} onChange={(ev) => field.onChange(ev.target.checked)} />} />
              <Field label="Provider utama">
                <Select {...form.register('primaryProvider')}>{AI_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}</Select>
              </Field>
            </div>
            <div className="sm:col-span-2"><Button type="submit" loading={save.isPending}>Simpan pengaturan</Button></div>
          </form>
        </Card>
        <div className="space-y-4">
          <Alert tone="warning" title="Sebelum mengaktifkan AI eksternal">
            Pastikan organisasi mengizinkan pengiriman surat dinas ke provider, telah meninjau penggunaan data, retensi, subprosesor, lokasi pemrosesan, serta perbedaan tier gratis/berbayar. API key hanya dikonfigurasi melalui environment server dan tidak pernah ditampilkan.
          </Alert>
          {providers.isLoading ? <Spinner /> : providers.data?.items.map((p) => <ProviderCard key={p.provider} p={p} />)}
        </div>
      </div>
    </div>
  );
}
