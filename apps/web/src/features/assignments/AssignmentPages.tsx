import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileOutput, Paperclip, Play, RotateCcw, Send, Trash2, UserCog, XCircle } from 'lucide-react';
import { ASSIGNMENT_STATUSES, ASSIGNMENT_STATUS_LABELS, OUTGOING_TYPE_LABELS, WORK_UPDATE_TYPE_LABELS } from '@sisurat/shared';
import { api, documentUrl } from '../../lib/api';
import { formatBytes, formatDate, formatDateTime, isOverdue } from '../../lib/format';
import type { DocumentInfo, Paged, UserRef, WorkUpdateInfo, AssignmentInfo } from '../../types/api';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  StatusBadge,
  Tabs,
  Textarea,
  useToast,
} from '../../components/ui';
import { DocumentViewer } from '../incoming-letters/components';
import { useAssignmentColumns } from '../dispositions/DispositionPages';

export function MyTasksPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const overdue = params.get('overdue') === 'true';
  const page = Number(params.get('page') ?? 1);
  const cols = useAssignmentColumns(false);
  const q = useQuery({
    queryKey: ['assignments', 'mine', status, overdue, page],
    queryFn: () => api.get<Paged<Parameters<typeof cols[0]['cell']>[0]>>('/assignments', { scope: 'mine', status, overdue: overdue ? 'true' : undefined, page }),
  });
  const tabs = [{ value: '', label: 'Semua' }, ...ASSIGNMENT_STATUSES.map((s) => ({ value: s, label: ASSIGNMENT_STATUS_LABELS[s] }))];
  return (
    <div>
      <PageHeader title="Tugas Saya" description="Penugasan dari disposisi pimpinan." breadcrumbs={[{ label: 'Beranda', to: '/' }, { label: 'Tugas Saya' }]} actions={<Checkbox label="Hanya yang terlambat" checked={overdue} onChange={(e) => setParams({ ...(status && { status }), ...(e.target.checked && { overdue: 'true' }) })} />} />
      <Tabs value={status} onChange={(v) => setParams({ ...(v && { status: v }), ...(overdue && { overdue: 'true' }) })} tabs={tabs} />
      <Card bodyClassName="p-0">
        {q.isLoading ? <Spinner /> : q.isError ? <div className="p-4"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div> : q.data && q.data.items.length === 0 ? (
          <EmptyState title="Tidak ada tugas" description="Penugasan baru dari pimpinan akan muncul di sini dan dikirim sebagai notifikasi." />
        ) : q.data ? (
          <>
            <DataTable columns={cols} rows={q.data.items} onRowClick={(r) => navigate(`/tugas/${r.id}`)} />
            <Pagination meta={q.data.meta} onPage={(p) => setParams({ ...(status && { status }), page: String(p) })} />
          </>
        ) : null}
      </Card>
    </div>
  );
}

interface AssignmentDetail extends AssignmentInfo {
  assignedBy: UserRef;
  reassignedFrom: { id: string; assignee: UserRef } | null;
  reassignedTo: { id: string; assignee: UserRef } | null;
  updates: WorkUpdateInfo[];
  disposition: {
    id: string;
    instruction: string;
    priority: string;
    dueDate: string | null;
    createdAt: string;
    issuer: UserRef;
    assignments: { id: string; status: string; assignee: UserRef }[];
    outgoingLetters: { id: string; number: string | null; subject: string; status: string; type: keyof typeof OUTGOING_TYPE_LABELS }[];
    incomingLetter: { id: string; agendaNumber: string | null; letterNumber: string | null; letterDate: string | null; senderName: string | null; subject: string | null; summary: string | null; status: string; confidentiality: string; documents: DocumentInfo[] };
  };
  actions: { start: boolean; update: boolean; review: boolean; cancel: boolean; reassign: boolean; createReply: boolean };
}

function Attachments({ docs }: { docs: DocumentInfo[] }) {
  if (!docs.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {docs.map((d) => (
        <li key={d.id}>
          <a href={documentUrl(d.id, !d.mimeType.startsWith('image/') && d.mimeType !== 'application/pdf')} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-brand-700 hover:bg-white">
            <Paperclip className="h-3 w-3" /> {d.originalName} ({formatBytes(d.sizeBytes)})
          </a>
        </li>
      ))}
    </ul>
  );
}

function UpdateForm({ assignmentId, onDone }: { assignmentId: string; onDone: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState('');
  const [submit, setSubmit] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const m = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('note', note);
      if (progress) fd.append('progressPercent', progress);
      fd.append('submitForReview', String(submit));
      for (const f of files) fd.append('files', f, f.name);
      return api.post(`/assignments/${assignmentId}/updates`, fd);
    },
    onSuccess: () => {
      toast.success(submit ? 'Hasil diajukan untuk pemeriksaan pimpinan' : 'Progres disimpan');
      setNote('');
      setProgress('');
      setSubmit(false);
      setFiles([]);
      onDone();
    },
    onError: (e) => toast.error(e),
  });
  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!note.trim()) return setError('Catatan wajib diisi');
        setError(null);
        m.mutate();
      }}
    >
      <Field label="Catatan progres / hasil" required error={error ?? undefined}>
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Progres (%)">
          <Input type="number" min={0} max={100} value={progress} onChange={(e) => setProgress(e.target.value)} />
        </Field>
        <Field label="Bukti / lampiran" hint="PDF, gambar, atau DOCX">
          <div>
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}><Paperclip className="h-4 w-4" /> Pilih berkas</Button>
            <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.docx" className="sr-only" aria-label="Pilih bukti" onChange={(e) => { if (e.target.files) setFiles([...files, ...Array.from(e.target.files)]); e.target.value = ''; }} />
          </div>
        </Field>
      </div>
      {files.length > 0 && (
        <ul className="space-y-1 text-xs">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2">
              {f.name} ({formatBytes(f.size)})
              <button type="button" aria-label={`Hapus ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5 text-slate-500" /></button>
            </li>
          ))}
        </ul>
      )}
      <Checkbox label="Pekerjaan selesai — ajukan untuk pemeriksaan pimpinan" checked={submit} onChange={(e) => setSubmit(e.target.checked)} />
      <div className="flex justify-end">
        <Button type="submit" loading={m.isPending}>
          <Send className="h-4 w-4" /> {submit ? 'Ajukan hasil' : 'Simpan progres'}
        </Button>
      </div>
    </form>
  );
}

export function AssignmentDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState<null | 'approve' | 'revise' | 'cancel' | 'reassign'>(null);
  const [reassignTo, setReassignTo] = useState('');
  const [reassignReason, setReassignReason] = useState('');
  const q = useQuery({ queryKey: ['assignment', id], queryFn: () => api.get<AssignmentDetail>(`/assignments/${id}`) });
  const staff = useQuery({ queryKey: ['directory', 'STAFF'], queryFn: () => api.get<{ items: UserRef[] }>('/users/directory', { role: 'STAFF' }), enabled: dialog === 'reassign' });
  const done = () => {
    setDialog(null);
    qc.invalidateQueries({ queryKey: ['assignment', id] });
    qc.invalidateQueries({ queryKey: ['assignments'] });
  };
  const start = useMutation({ mutationFn: () => api.post(`/assignments/${id}/start`), onSuccess: () => { toast.success('Tugas dimulai'); done(); }, onError: (e) => toast.error(e) });
  const review = useMutation({
    mutationFn: (v: { decision: 'APPROVE' | 'REQUEST_REVISION'; note: string }) => api.post(`/assignments/${id}/review`, v),
    onSuccess: (_d, v) => { toast.success(v.decision === 'APPROVE' ? 'Tindak lanjut disetujui' : 'Permintaan revisi dikirim'); done(); },
    onError: (e) => toast.error(e),
  });
  const cancel = useMutation({ mutationFn: (reason: string) => api.post(`/assignments/${id}/cancel`, { reason }), onSuccess: () => { toast.success('Penugasan dibatalkan'); done(); }, onError: (e) => toast.error(e) });
  const reassign = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/assignments/${id}/reassign`, { newAssigneeId: reassignTo, reason: reassignReason }),
    onSuccess: (r) => { toast.success('Penugasan dialihkan'); done(); navigate(`/tugas/${r.id}`); },
    onError: (e) => toast.error(e),
  });

  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const a = q.data;
  const d = a.disposition;
  const L = d.incomingLetter;
  const overdue = isOverdue(a.dueDate, a.status);

  return (
    <div>
      <PageHeader
        title={L.subject ?? 'Penugasan'}
        breadcrumbs={[{ label: 'Tugas', to: '/tugas' }, { label: L.agendaNumber ?? 'Surat', to: `/surat-masuk/${L.id}` }, { label: a.assignee.fullName }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            Pelaksana: {a.assignee.fullName} <StatusBadge kind="assignment" value={a.status} /> <StatusBadge kind="priority" value={d.priority} />
            {a.dueDate && <Badge tone={overdue ? 'red' : 'gray'}>Tenggat {formatDate(a.dueDate)}{overdue ? ' — terlambat' : ''}</Badge>}
          </span>
        }
        actions={
          <>
            {a.actions.start && <Button loading={start.isPending} onClick={() => start.mutate()}><Play className="h-4 w-4" /> Mulai kerjakan</Button>}
            {a.actions.review && <Button variant="success" onClick={() => setDialog('approve')}><CheckCircle2 className="h-4 w-4" /> Setujui</Button>}
            {a.actions.review && <Button variant="secondary" onClick={() => setDialog('revise')}><RotateCcw className="h-4 w-4" /> Minta revisi</Button>}
            {a.actions.createReply && <Button variant="secondary" onClick={() => navigate(`/surat-keluar/baru?incoming=${L.id}&disposition=${d.id}`)}><FileOutput className="h-4 w-4" /> Draf surat balasan</Button>}
            {a.actions.reassign && <Button variant="ghost" onClick={() => setDialog('reassign')}><UserCog className="h-4 w-4" /> Alihkan</Button>}
            {a.actions.cancel && <Button variant="ghost" className="text-red-600" onClick={() => setDialog('cancel')}><XCircle className="h-4 w-4" /> Batalkan</Button>}
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-3">
          <Card title={`Arahan dari ${d.issuer.fullName}`} actions={<span className="text-xs text-slate-500">{formatDateTime(d.createdAt)}</span>}>
            <p className="text-sm whitespace-pre-line text-slate-800">{d.instruction}</p>
            {d.assignments.length > 1 && (
              <p className="mt-3 text-xs text-slate-500">Pelaksana lain: {d.assignments.filter((x) => x.id !== a.id).map((x) => `${x.assignee.fullName} (${ASSIGNMENT_STATUS_LABELS[x.status as keyof typeof ASSIGNMENT_STATUS_LABELS]})`).join(', ')}</p>
            )}
            {a.reassignedFrom && <p className="mt-2 text-xs text-slate-500">Dialihkan dari <Link className="underline" to={`/tugas/${a.reassignedFrom.id}`}>{a.reassignedFrom.assignee.fullName}</Link></p>}
            {a.reassignedTo && <p className="mt-2 text-xs text-amber-700">Dialihkan ke <Link className="underline" to={`/tugas/${a.reassignedTo.id}`}>{a.reassignedTo.assignee.fullName}</Link></p>}
            {a.cancelReason && <p className="mt-2 text-xs text-red-700">Dibatalkan: {a.cancelReason}</p>}
          </Card>
          <Card title="Riwayat progres & persetujuan">
            {a.updates.length === 0 ? <p className="text-sm text-slate-500">Belum ada catatan progres.</p> : (
              <ol className="relative space-y-4 border-l border-slate-200 pl-5">
                {a.updates.map((u) => (
                  <li key={u.id} className="relative">
                    <span className={`absolute top-1.5 -left-[25px] h-2.5 w-2.5 rounded-full ring-4 ring-white ${u.type === 'APPROVED' ? 'bg-emerald-500' : u.type === 'REVISION_REQUESTED' || u.type === 'CANCELLED' ? 'bg-red-500' : 'bg-brand-600'}`} aria-hidden />
                    <p className="text-sm font-medium text-slate-800">{WORK_UPDATE_TYPE_LABELS[u.type]}{u.progressPercent != null && <span className="ml-2 text-xs font-normal text-slate-500">{u.progressPercent}%</span>}</p>
                    <p className="text-xs text-slate-500">{u.author.fullName} · {formatDateTime(u.createdAt)}</p>
                    {u.note && <p className="mt-1 text-sm whitespace-pre-line text-slate-700">{u.note}</p>}
                    <Attachments docs={u.attachments} />
                  </li>
                ))}
              </ol>
            )}
          </Card>
          {a.actions.update && (
            <Card title="Perbarui progres">
              <UpdateForm assignmentId={a.id} onDone={done} />
            </Card>
          )}
        </div>
        <div className="space-y-4 xl:col-span-2">
          <Card title="Surat">
            <DescriptionList
              items={[
                { label: 'No. agenda', value: <Link to={`/surat-masuk/${L.id}`} className="text-brand-700 hover:underline">{L.agendaNumber}</Link> },
                { label: 'Nomor surat', value: L.letterNumber },
                { label: 'Pengirim', value: L.senderName },
                { label: 'Tanggal', value: formatDate(L.letterDate) },
                { label: 'Ringkasan', value: L.summary, wide: true },
              ]}
            />
          </Card>
          {d.outgoingLetters.length > 0 && (
            <Card title="Surat keluar terkait">
              <ul className="space-y-1 text-sm">
                {d.outgoingLetters.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2">
                    <Link to={`/surat-keluar/${o.id}`} className="text-brand-700 hover:underline">{o.number ?? 'Draft'} — {o.subject}</Link>
                    <StatusBadge kind="outgoing" value={o.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <DocumentViewer documents={L.documents} />
        </div>
      </div>

      <ConfirmDialog open={dialog === 'approve'} onClose={() => setDialog(null)} onConfirm={(note) => review.mutate({ decision: 'APPROVE', note })} loading={review.isPending} title="Setujui hasil tindak lanjut?" message="Penugasan akan ditandai selesai. Surat selesai bila semua pelaksana telah disetujui." confirmLabel="Setujui" tone="success" />
      <ConfirmDialog open={dialog === 'revise'} onClose={() => setDialog(null)} onConfirm={(note) => review.mutate({ decision: 'REQUEST_REVISION', note })} loading={review.isPending} title="Minta revisi" message="Jelaskan perbaikan yang diperlukan." confirmLabel="Kirim permintaan revisi" requireReason reasonLabel="Catatan revisi" />
      <ConfirmDialog open={dialog === 'cancel'} onClose={() => setDialog(null)} onConfirm={(reason) => cancel.mutate(reason)} loading={cancel.isPending} title="Batalkan penugasan?" message="Pelaksana akan menerima notifikasi pembatalan." confirmLabel="Batalkan penugasan" tone="danger" requireReason />
      <Dialog
        open={dialog === 'reassign'}
        onClose={() => setDialog(null)}
        title="Alihkan penugasan"
        footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Batal</Button><Button disabled={!reassignTo || reassignReason.trim().length < 5} loading={reassign.isPending} onClick={() => reassign.mutate()}>Alihkan</Button></>}
      >
        <div className="space-y-4">
          <Field label="Pelaksana baru" required>
            <Select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
              <option value="">— Pilih —</option>
              {staff.data?.items.filter((u) => u.id !== a.assignee.id).map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </Select>
          </Field>
          <Field label="Alasan" required hint="Minimal 5 karakter">
            <Textarea value={reassignReason} onChange={(e) => setReassignReason(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
