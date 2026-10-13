import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Archive, Ban, CheckSquare, Edit, FilePlus2, FileOutput, Paperclip, Send, Stamp } from 'lucide-react';
import { LETTER_TYPE_LABELS, OUTGOING_TYPE_LABELS } from '@sisurat/shared';
import { api } from '../../lib/api';
import { formatDate, formatDateTime, isOverdue, toInputDate } from '../../lib/format';
import type { HistoryItem, LetterDetail, UserRef } from '../../types/api';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DescriptionList,
  Dialog,
  ErrorState,
  Field,
  PageHeader,
  Select,
  Spinner,
  StatusBadge,
  Tabs,
  Textarea,
  useToast,
} from '../../components/ui';
import { DocumentViewer, LetterMetadataFields, toPayload, type LetterFormValues } from './components';
import { actionLabel, HistoryList } from '../../components/HistoryList';

function EditDialog({ letter, open, onClose }: { letter: LetterDetail; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const form = useForm<LetterFormValues>({
    values: {
      letterType: letter.letterType ?? '',
      letterNumber: letter.letterNumber ?? '',
      letterDate: toInputDate(letter.letterDate),
      receivedDate: toInputDate(letter.receivedDate),
      senderName: letter.senderName ?? '',
      recipientName: letter.recipientName ?? '',
      subject: letter.subject ?? '',
      attachmentText: letter.attachmentText ?? '',
      eventDate: toInputDate(letter.eventDate),
      eventLocation: letter.eventLocation ?? '',
      summary: letter.summary ?? '',
      category: letter.category ?? '',
      priority: letter.priority,
      confidentiality: letter.confidentiality,
      notes: letter.notes ?? '',
    },
  });
  const m = useMutation({
    mutationFn: (v: LetterFormValues) => {
      // Only changed fields are sent, so the audit trail shows exactly what was corrected.
      const changed = Object.keys(form.formState.dirtyFields) as (keyof LetterFormValues)[];
      return api.patch(`/incoming-letters/${letter.id}`, toPayload(Object.fromEntries(changed.map((k) => [k, v[k]]))));
    },
    onSuccess: () => {
      toast.success('Metadata diperbarui. Perubahan dicatat di riwayat.');
      qc.invalidateQueries({ queryKey: ['letter', letter.id] });
      onClose();
    },
    onError: (e) => toast.error(e),
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title="Ubah metadata surat"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button loading={m.isPending} onClick={form.handleSubmit((v) => m.mutate(v))}>Simpan perubahan</Button>
        </>
      }
    >
      {letter.verifiedAt && <p className="mb-3 text-xs text-amber-700">Surat sudah terdaftar: setiap perubahan dicatat sebagai koreksi beserta nilai sebelumnya.</p>}
      <LetterMetadataFields register={form.register} errors={form.formState.errors} />
    </Dialog>
  );
}

function ForwardDialog({ letter, open, onClose }: { letter: LetterDetail; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const leaders = useQuery({ queryKey: ['directory', 'LEADER'], queryFn: () => api.get<{ items: UserRef[] }>('/users/directory', { role: 'LEADER' }), enabled: open });
  const [leaderId, setLeaderId] = useState('');
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/incoming-letters/${letter.id}/forward`, { leaderId, note }),
    onSuccess: () => {
      toast.success('Surat diteruskan untuk disposisi');
      qc.invalidateQueries({ queryKey: ['letter', letter.id] });
      onClose();
    },
    onError: (e) => toast.error(e),
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Teruskan untuk disposisi"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button disabled={!leaderId} loading={m.isPending} onClick={() => m.mutate()}>Teruskan</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Pimpinan / pejabat disposisi" required>
          <Select value={leaderId} onChange={(e) => setLeaderId(e.target.value)}>
            <option value="">— Pilih —</option>
            {leaders.data?.items.map((u) => <option key={u.id} value={u.id}>{u.fullName}{u.position ? ` — ${u.position}` : ''}</option>)}
          </Select>
        </Field>
        <Field label="Catatan (opsional)">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

export function LetterDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'info' | 'disposisi' | 'ekstraksi' | 'riwayat'>('info');
  const [dialog, setDialog] = useState<null | 'edit' | 'forward' | 'archive' | 'cancel'>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const q = useQuery({ queryKey: ['letter', id], queryFn: () => api.get<LetterDetail>(`/incoming-letters/${id}`) });
  const history = useQuery({
    queryKey: ['letter', id, 'history'],
    queryFn: () => api.get<{ items: HistoryItem[] }>(`/incoming-letters/${id}/history`),
    enabled: tab === 'riwayat',
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['letter', id] });

  const archive = useMutation({
    mutationFn: (note: string) => api.post(`/incoming-letters/${id}/archive`, { note }),
    onSuccess: () => { toast.success('Surat diarsipkan'); setDialog(null); invalidate(); },
    onError: (e) => toast.error(e),
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => api.post(`/incoming-letters/${id}/cancel`, { reason }),
    onSuccess: () => { toast.success('Surat dibatalkan'); setDialog(null); navigate('/surat-masuk'); },
    onError: (e) => toast.error(e),
  });
  const addDocs = useMutation({
    mutationFn: (files: FileList) => {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append('files', f, f.name);
      return api.post(`/incoming-letters/${id}/documents`, fd);
    },
    onSuccess: () => { toast.success('Lampiran ditambahkan'); invalidate(); },
    onError: (e) => toast.error(e),
  });

  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const l = q.data;
  const a = l.actions;

  return (
    <div>
      <PageHeader
        title={l.subject ?? '(belum ada perihal)'}
        breadcrumbs={[{ label: 'Beranda', to: '/' }, { label: l.status === 'ARCHIVED' ? 'Arsip' : 'Surat Masuk', to: l.status === 'ARCHIVED' ? '/arsip' : '/surat-masuk' }, { label: l.agendaNumber ?? 'Draft' }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{l.agendaNumber ? `No. Agenda ${l.agendaNumber}` : 'Belum terdaftar'}</span>
            <StatusBadge kind="letter" value={l.status} />
            {l.status === 'DRAFT' && <StatusBadge kind="processing" value={l.processingStatus} />}
            <StatusBadge kind="priority" value={l.priority} />
            <StatusBadge kind="confidentiality" value={l.confidentiality} />
          </span>
        }
        actions={
          <>
            {a.verify && <Button onClick={() => navigate(`/surat-masuk/${id}/verifikasi`)}><CheckSquare className="h-4 w-4" /> Verifikasi</Button>}
            {a.forward && <Button onClick={() => setDialog('forward')}><Send className="h-4 w-4" /> Teruskan</Button>}
            {a.dispose && <Button onClick={() => navigate(`/surat-masuk/${id}/disposisi`)}><Stamp className="h-4 w-4" /> Beri disposisi</Button>}
            {a.edit && !a.verify && <Button variant="secondary" onClick={() => setDialog('edit')}><Edit className="h-4 w-4" /> Ubah</Button>}
            {a.addDocuments && (
              <>
                <Button variant="secondary" loading={addDocs.isPending} onClick={() => fileRef.current?.click()}><Paperclip className="h-4 w-4" /> Lampiran</Button>
                <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="sr-only" aria-label="Tambah lampiran" onChange={(e) => { if (e.target.files?.length) addDocs.mutate(e.target.files); e.target.value = ''; }} />
              </>
            )}
            {a.createReply && <Button variant="secondary" onClick={() => navigate(`/surat-keluar/baru?incoming=${id}`)}><FileOutput className="h-4 w-4" /> Surat balasan</Button>}
            {a.archive && <Button variant="secondary" onClick={() => setDialog('archive')}><Archive className="h-4 w-4" /> Arsipkan</Button>}
            {a.cancel && <Button variant="ghost" className="text-red-600" onClick={() => setDialog('cancel')}><Ban className="h-4 w-4" /> Batalkan</Button>}
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="xl:col-span-2">
          <DocumentViewer documents={l.documents} className="xl:sticky xl:top-20" />
        </div>
        <div className="min-w-0 xl:col-span-3">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'info', label: 'Metadata' },
              { value: 'disposisi', label: 'Disposisi & tindak lanjut', count: l.dispositions.length },
              { value: 'ekstraksi', label: 'OCR / AI', count: l.extractionJobs.length },
              { value: 'riwayat', label: 'Riwayat' },
            ]}
          />
          {tab === 'info' && (
            <div className="space-y-4">
              <Card>
                <DescriptionList
                  items={[
                    { label: 'Nomor surat', value: l.letterNumber },
                    { label: 'Jenis', value: l.letterType ? LETTER_TYPE_LABELS[l.letterType] : null },
                    { label: 'Tanggal surat', value: formatDate(l.letterDate) },
                    { label: 'Tanggal diterima', value: formatDate(l.receivedDate) },
                    { label: 'Pengirim', value: l.senderName },
                    { label: 'Penerima', value: l.recipientName },
                    { label: 'Perihal', value: l.subject, wide: true },
                    { label: 'Lampiran', value: l.attachmentText },
                    { label: 'Kategori', value: l.category },
                    { label: 'Tanggal kegiatan', value: formatDate(l.eventDate) },
                    { label: 'Tempat kegiatan', value: l.eventLocation },
                    { label: 'Ringkasan', value: l.summary, wide: true },
                    { label: 'Catatan', value: l.notes, wide: true },
                  ]}
                />
              </Card>
              <Card title="Pencatatan">
                <DescriptionList
                  items={[
                    { label: 'Dicatat oleh', value: `${l.createdBy.fullName} · ${formatDateTime(l.createdAt)}` },
                    { label: 'Diverifikasi oleh', value: l.verifiedBy ? `${l.verifiedBy.fullName} · ${formatDateTime(l.verifiedAt)}` : '-' },
                    { label: 'Diteruskan kepada', value: l.forwardedTo ? `${l.forwardedTo.fullName} · ${formatDateTime(l.forwardedAt)}` : '-' },
                    { label: 'Selesai / diarsipkan', value: l.archivedAt ? formatDateTime(l.archivedAt) : l.completedAt ? formatDateTime(l.completedAt) : '-' },
                  ]}
                />
              </Card>
              {l.outgoingLinks.length > 0 && (
                <Card title="Surat keluar terkait">
                  <ul className="space-y-2 text-sm">
                    {l.outgoingLinks.map(({ outgoingLetter: o }) => (
                      <li key={o.id} className="flex items-center justify-between gap-2">
                        <Link to={`/surat-keluar/${o.id}`} className="text-brand-700 hover:underline">{o.number ?? 'Draft'} — {o.subject}</Link>
                        <span className="flex gap-1"><Badge>{OUTGOING_TYPE_LABELS[o.type]}</Badge><StatusBadge kind="outgoing" value={o.status} /></span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              {l.corrections.length > 0 && (
                <Card title={`Riwayat koreksi metadata (${l.corrections.length})`} bodyClassName="p-0">
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-3 py-2">Field</th><th className="px-3 py-2">Sebelumnya</th><th className="px-3 py-2">Menjadi</th><th className="px-3 py-2">Oleh</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {l.corrections.map((c) => (
                          <tr key={c.id}>
                            <td className="px-3 py-2 font-medium">{c.field}<p className="font-normal text-slate-400">{c.source === 'VERIFICATION' ? 'Saat verifikasi (nilai AI)' : 'Setelah terdaftar'}</p></td>
                            <td className="px-3 py-2 text-red-700 line-through decoration-red-300">{c.previousValue ?? '—'}</td>
                            <td className="px-3 py-2 text-emerald-700">{c.newValue ?? '—'}</td>
                            <td className="px-3 py-2">{c.correctedBy.fullName}<p className="text-slate-400">{formatDateTime(c.createdAt)}</p></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          )}
          {tab === 'disposisi' && (
            <div className="space-y-4">
              {l.dispositions.length === 0 ? (
                <Card><p className="py-6 text-center text-sm text-slate-500">{l.status === 'AWAITING_DISPOSITION' ? `Menunggu disposisi dari ${l.forwardedTo?.fullName ?? 'pimpinan'}.` : 'Belum ada disposisi.'}</p></Card>
              ) : (
                l.dispositions.map((d) => (
                  <Card
                    key={d.id}
                    title={<span className="flex flex-wrap items-center gap-2">Disposisi dari {d.issuer.fullName} <StatusBadge kind="disposition" value={d.status} /><StatusBadge kind="priority" value={d.priority} /></span>}
                    actions={<span className="text-xs text-slate-500">{formatDateTime(d.createdAt)}{d.dueDate && ` · tenggat ${formatDate(d.dueDate)}`}</span>}
                  >
                    <p className="text-sm whitespace-pre-line text-slate-800">{d.instruction}</p>
                    {d.cancelReason && <p className="mt-2 text-xs text-red-700">Dibatalkan: {d.cancelReason}</p>}
                    <ul className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200">
                      {d.assignments.map((as) => (
                        <li key={as.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                          <div>
                            <Link to={`/tugas/${as.id}`} className="text-sm font-medium text-brand-700 hover:underline">{as.assignee.fullName}</Link>
                            <p className="text-xs text-slate-500">
                              {as.updates.length} catatan · progres {as.progressPercent}%
                              {as.dueDate && <span className={isOverdue(as.dueDate, as.status) ? ' font-medium text-red-600' : ''}> · tenggat {formatDate(as.dueDate)}</span>}
                            </p>
                          </div>
                          <StatusBadge kind="assignment" value={as.status} />
                        </li>
                      ))}
                    </ul>
                  </Card>
                ))
              )}
              {a.dispose && <Button variant="secondary" onClick={() => navigate(`/surat-masuk/${id}/disposisi`)}><FilePlus2 className="h-4 w-4" /> Tambah disposisi</Button>}
            </div>
          )}
          {tab === 'ekstraksi' && (
            <Card bodyClassName="p-0">
              {l.extractionJobs.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">Belum ada proses ekstraksi. Surat dicatat secara manual.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {l.extractionJobs.map((j) => (
                    <li key={j.id} className="px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge kind="job" value={j.status} />
                        <span className="font-medium">{j.method ? actionLabel(`method.${j.method}`) : 'Menunggu'}</span>
                        {j.provider && <Badge tone="indigo">{j.provider}{j.model ? ` · ${j.model}` : ''}</Badge>}
                        <span className="text-xs text-slate-500">{formatDateTime(j.createdAt)} · percobaan {j.attempts}/{j.maxAttempts}</span>
                      </div>
                      {j.errorMessage && <p className="mt-1 text-xs text-red-700">{j.errorCode}: {j.errorMessage}</p>}
                      <p className="mt-1 text-xs text-slate-500">
                        {j.durationMs != null && `Durasi ${(j.durationMs / 1000).toFixed(1)} dtk · `}
                        {j.inputTokens != null && `Token ${j.inputTokens}/${j.outputTokens} · `}
                        {j.estimatedCostUsd != null && `Biaya ±US$${j.estimatedCostUsd.toFixed(5)} · `}
                        {j.promptVersion && `Prompt ${j.promptVersion}`}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {tab === 'riwayat' && (
            <Card>{history.isLoading ? <Spinner /> : history.isError ? <ErrorState error={history.error} /> : <HistoryList items={history.data?.items ?? []} />}</Card>
          )}
        </div>
      </div>

      <EditDialog letter={l} open={dialog === 'edit'} onClose={() => setDialog(null)} />
      <ForwardDialog letter={l} open={dialog === 'forward'} onClose={() => setDialog(null)} />
      <ConfirmDialog
        open={dialog === 'archive'}
        onClose={() => setDialog(null)}
        onConfirm={(note) => archive.mutate(note)}
        loading={archive.isPending}
        title="Arsipkan surat?"
        message="Surat akan dipindahkan ke arsip dan tidak dapat diubah lagi."
        confirmLabel="Arsipkan"
      />
      <ConfirmDialog
        open={dialog === 'cancel'}
        onClose={() => setDialog(null)}
        onConfirm={(reason) => cancel.mutate(reason)}
        loading={cancel.isPending}
        title="Batalkan surat?"
        message={l.status === 'DRAFT' ? 'Draft akan dihapus (soft delete). Dokumen asli tetap tersimpan untuk audit.' : 'Surat terdaftar akan berstatus Dibatalkan; disposisi aktif ikut dibatalkan. Nomor agenda tetap tercatat.'}
        tone="danger"
        confirmLabel="Batalkan surat"
        requireReason
      />
    </div>
  );
}
