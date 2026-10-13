import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, Download, Edit, Hash, RotateCcw, Send } from 'lucide-react';
import { OUTGOING_TYPE_LABELS, type OutgoingStatus, type OutgoingType, type PlaceholderDef } from '@sisurat/shared';
import { api, documentUrl } from '../../lib/api';
import { formatBytes, formatDateTime } from '../../lib/format';
import type { DocumentInfo, HistoryItem, UserRef } from '../../types/api';
import { Alert, Badge, Button, Card, ConfirmDialog, DescriptionList, ErrorState, PageHeader, Spinner, StatusBadge, useToast } from '../../components/ui';
import { HistoryList } from '../../components/HistoryList';

interface OutgoingDetail {
  id: string;
  type: OutgoingType;
  number: string | null;
  subject: string;
  recipient: string;
  status: OutgoingStatus;
  confidentiality: string;
  templateVersion: number;
  data: Record<string, string>;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  finalizedAt: string | null;
  createdBy: UserRef;
  reviewedBy: UserRef | null;
  finalizedBy: UserRef | null;
  template: { id: string; name: string; version: number; placeholders: PlaceholderDef[] };
  documents: (DocumentInfo & { version: number })[];
  links: { incomingLetter: { id: string; agendaNumber: string | null; subject: string | null; senderName: string | null } }[];
  disposition: { id: string; instruction: string; incomingLetterId: string } | null;
  history: HistoryItem[];
  actions: { edit: boolean; submit: boolean; review: boolean; finalize: boolean; cancel: boolean };
}

export function OutgoingDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState<null | 'submit' | 'approve' | 'revise' | 'finalize' | 'cancel'>(null);
  const q = useQuery({ queryKey: ['outgoing', id], queryFn: () => api.get<OutgoingDetail>(`/outgoing-letters/${id}`) });
  const done = (msg: string) => {
    toast.success(msg);
    setDialog(null);
    qc.invalidateQueries({ queryKey: ['outgoing'] });
  };
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api.post(`/outgoing-letters/${id}/${path}`, body),
    onError: (e) => toast.error(e),
  });

  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data;
  const latest = o.documents[0];

  return (
    <div>
      <PageHeader
        title={o.subject}
        breadcrumbs={[{ label: 'Surat Keluar', to: '/surat-keluar' }, { label: o.number ?? 'Draft' }]}
        description={<span className="flex flex-wrap items-center gap-2">{OUTGOING_TYPE_LABELS[o.type]} <StatusBadge kind="outgoing" value={o.status} /> <StatusBadge kind="confidentiality" value={o.confidentiality} /> {o.number && <Badge tone="green">No. {o.number}</Badge>}</span>}
        actions={
          <>
            {latest && <a href={documentUrl(latest.id, true)}><Button variant="secondary"><Download className="h-4 w-4" /> Unduh DOCX</Button></a>}
            {o.actions.edit && <Button variant="secondary" onClick={() => navigate(`/surat-keluar/${id}/ubah`)}><Edit className="h-4 w-4" /> Ubah</Button>}
            {o.actions.submit && <Button onClick={() => setDialog('submit')}><Send className="h-4 w-4" /> Ajukan pemeriksaan</Button>}
            {o.actions.review && <Button variant="success" onClick={() => setDialog('approve')}><CheckCircle2 className="h-4 w-4" /> Setujui</Button>}
            {o.actions.review && <Button variant="secondary" onClick={() => setDialog('revise')}><RotateCcw className="h-4 w-4" /> Minta revisi</Button>}
            {o.actions.finalize && <Button onClick={() => setDialog('finalize')}><Hash className="h-4 w-4" /> Beri nomor & finalkan</Button>}
            {o.actions.cancel && <Button variant="ghost" className="text-red-600" onClick={() => setDialog('cancel')}><Ban className="h-4 w-4" /> Batalkan</Button>}
          </>
        }
      />
      {o.status === 'NEEDS_REVISION' && o.reviewNote && <div className="mb-4"><Alert tone="warning" title={`Catatan revisi dari ${o.reviewedBy?.fullName ?? 'pemeriksa'}`}>{o.reviewNote}</Alert></div>}
      {o.status === 'FINAL' && <div className="mb-4"><Alert tone="info">Dokumen final telah dibuat. Pengesahan (tanda tangan/cap) tetap mengikuti proses resmi kantor; sistem tidak mengirim surat secara otomatis.</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Data surat">
            <DescriptionList
              items={[
                { label: 'Tujuan', value: o.recipient },
                { label: 'Templat', value: `${o.template.name} (versi ${o.templateVersion})` },
                ...o.template.placeholders.map((p) => ({ label: p.label, value: o.data[p.key] || '-', wide: p.multiline })),
              ]}
            />
          </Card>
          <Card title="Versi dokumen" bodyClassName="p-0">
            <ul className="divide-y divide-slate-100">
              {o.documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <span>
                    <Badge tone={d.version === latest?.version ? 'blue' : 'gray'}>v{d.version}</Badge> <span className="ml-1">{d.originalName}</span>
                    <span className="ml-2 text-xs text-slate-500">{formatBytes(d.sizeBytes)} · {d.uploadedBy.fullName} · {formatDateTime(d.createdAt)}</span>
                  </span>
                  <a href={documentUrl(d.id, true)} className="text-xs text-brand-700 hover:underline">Unduh</a>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Alur persetujuan">
            <DescriptionList
              items={[
                { label: 'Disusun', value: `${o.createdBy.fullName} · ${formatDateTime(o.createdAt)}`, wide: true },
                { label: 'Diperiksa', value: o.reviewedBy ? `${o.reviewedBy.fullName} · ${formatDateTime(o.reviewedAt)}` : '-', wide: true },
                { label: 'Difinalkan', value: o.finalizedBy ? `${o.finalizedBy.fullName} · ${formatDateTime(o.finalizedAt)}` : '-', wide: true },
              ]}
            />
          </Card>
          <Card title="Surat masuk terkait">
            {o.links.length === 0 ? <p className="text-sm text-slate-500">Tidak ada.</p> : (
              <ul className="space-y-1 text-sm">
                {o.links.map(({ incomingLetter: l }) => <li key={l.id}><Link to={`/surat-masuk/${l.id}`} className="text-brand-700 hover:underline">{l.agendaNumber}</Link> — {l.subject}</li>)}
              </ul>
            )}
            {o.disposition && <p className="mt-2 text-xs text-slate-500">Dari disposisi: “{o.disposition.instruction.slice(0, 120)}”</p>}
          </Card>
          <Card title="Riwayat"><HistoryList items={o.history.map((h) => ({ ...h, entityType: 'OutgoingLetter', summary: null, before: null }))} /></Card>
        </div>
      </div>

      <ConfirmDialog open={dialog === 'submit'} onClose={() => setDialog(null)} loading={act.isPending} title="Ajukan untuk pemeriksaan?" message="Draft akan dikunci sampai pemeriksa menyetujui atau meminta revisi." onConfirm={() => act.mutate({ path: 'submit' }, { onSuccess: () => done('Diajukan untuk pemeriksaan') })} />
      <ConfirmDialog open={dialog === 'approve'} onClose={() => setDialog(null)} loading={act.isPending} tone="success" confirmLabel="Setujui" title="Setujui surat keluar?" message="Setelah disetujui, petugas TU dapat memberi nomor dan memfinalkan surat." onConfirm={(note) => act.mutate({ path: 'review', body: { decision: 'APPROVE', note } }, { onSuccess: () => done('Surat disetujui') })} />
      <ConfirmDialog open={dialog === 'revise'} onClose={() => setDialog(null)} loading={act.isPending} requireReason reasonLabel="Catatan revisi" confirmLabel="Kirim revisi" title="Minta revisi" message="Penyusun akan menerima notifikasi." onConfirm={(note) => act.mutate({ path: 'review', body: { decision: 'REQUEST_REVISION', note } }, { onSuccess: () => done('Permintaan revisi dikirim') })} />
      <ConfirmDialog open={dialog === 'finalize'} onClose={() => setDialog(null)} loading={act.isPending} confirmLabel="Finalkan" title="Beri nomor dan finalkan?" message="Nomor surat keluar dialokasikan sesuai format kantor dan tidak dapat diubah. Dokumen DOCX final dibuat sebagai versi baru." onConfirm={() => act.mutate({ path: 'finalize' }, { onSuccess: () => done('Surat difinalkan dan diberi nomor') })} />
      <ConfirmDialog open={dialog === 'cancel'} onClose={() => setDialog(null)} loading={act.isPending} tone="danger" requireReason confirmLabel="Batalkan" title="Batalkan surat keluar?" message="Surat akan berstatus Dibatalkan." onConfirm={(reason) => act.mutate({ path: 'cancel', body: { reason } }, { onSuccess: () => done('Surat dibatalkan') })} />
    </div>
  );
}
