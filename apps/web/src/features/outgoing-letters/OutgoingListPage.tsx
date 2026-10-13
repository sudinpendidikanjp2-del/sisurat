import { useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { OUTGOING_STATUSES, OUTGOING_STATUS_LABELS, OUTGOING_TYPES, OUTGOING_TYPE_LABELS, type OutgoingStatus, type OutgoingType } from '@sisurat/shared';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import type { Paged, UserRef } from '../../types/api';
import { Button, Card, DataTable, EmptyState, ErrorState, Field, Input, PageHeader, Pagination, Select, Spinner, StatusBadge, type Column } from '../../components/ui';
import { useAuth } from '../auth/AuthContext';

export interface OutgoingRow {
  id: string;
  type: OutgoingType;
  number: string | null;
  subject: string;
  recipient: string;
  status: OutgoingStatus;
  templateVersion: number;
  createdAt: string;
  finalizedAt: string | null;
  createdBy: UserRef;
  links: { incomingLetter: { id: string; agendaNumber: string | null } }[];
}

const columns: Column<OutgoingRow>[] = [
  { header: 'Nomor', cell: (r) => <div><p className="font-medium">{r.number ?? <span className="text-slate-400 italic">Belum bernomor</span>}</p><p className="text-xs text-slate-500">{OUTGOING_TYPE_LABELS[r.type]}</p></div> },
  { header: 'Perihal / Tujuan', className: 'min-w-[14rem]', cell: (r) => <div><p className="font-medium text-slate-900">{r.subject}</p><p className="text-xs text-slate-500">Kepada {r.recipient}</p></div> },
  { header: 'Status', cell: (r) => <StatusBadge kind="outgoing" value={r.status} /> },
  { header: 'Terkait surat masuk', hideOnMobile: true, cell: (r) => <span className="text-xs">{r.links.map((l) => l.incomingLetter.agendaNumber).filter(Boolean).join(', ') || '-'}</span> },
  { header: 'Penyusun', hideOnMobile: true, cell: (r) => <div className="text-xs"><p>{r.createdBy.fullName}</p><p className="text-slate-500">{formatDate(r.createdAt)}</p></div> },
];

export function OutgoingListPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = { q: params.get('q') ?? '', status: params.get('status') ?? '', type: params.get('type') ?? '', page: Number(params.get('page') ?? 1) };
  const q = useQuery({ queryKey: ['outgoing', query], queryFn: () => api.get<Paged<OutgoingRow>>('/outgoing-letters', query), placeholderData: keepPreviousData });
  const reviewQueue = useQuery({
    queryKey: ['outgoing', 'review-queue'],
    queryFn: () => api.get<{ items: OutgoingRow[] }>('/outgoing-letters/review-queue'),
    enabled: can('outgoing.review'),
  });
  return (
    <div>
      <PageHeader
        title="Surat Keluar"
        description="Surat keluar yang disusun dari templat DOCX resmi. Nomor diberikan saat finalisasi setelah disetujui."
        breadcrumbs={[{ label: 'Beranda', to: '/' }, { label: 'Surat Keluar' }]}
        actions={can('outgoing.create') ? <Button onClick={() => navigate('/surat-keluar/baru')}><Plus className="h-4 w-4" /> Buat surat</Button> : undefined}
      />
      {reviewQueue.data && reviewQueue.data.items.length > 0 && (
        <Card title={`Menunggu pemeriksaan Anda (${reviewQueue.data.items.length})`} className="mb-4" bodyClassName="p-0">
          <ul className="divide-y divide-slate-100">
            {reviewQueue.data.items.map((r) => (
              <li key={r.id}>
                <button type="button" className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-slate-50" onClick={() => navigate(`/surat-keluar/${r.id}`)}>
                  <span><span className="font-medium">{r.subject}</span> <span className="text-xs text-slate-500">· {OUTGOING_TYPE_LABELS[r.type]} · {r.createdBy.fullName}</span></span>
                  <StatusBadge kind="outgoing" value={r.status} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card className="mb-4">
        <form
          className="grid gap-3 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const next: Record<string, string> = {};
            for (const k of ['q', 'status', 'type']) if (fd.get(k)) next[k] = String(fd.get(k));
            setParams(next);
          }}
        >
          <Field label="Cari" className="sm:col-span-2"><Input name="q" defaultValue={query.q} placeholder="Perihal, nomor, tujuan…" /></Field>
          <Field label="Status"><Select name="status" defaultValue={query.status}><option value="">Semua</option>{OUTGOING_STATUSES.map((s) => <option key={s} value={s}>{OUTGOING_STATUS_LABELS[s]}</option>)}</Select></Field>
          <Field label="Jenis"><Select name="type" defaultValue={query.type}><option value="">Semua</option>{OUTGOING_TYPES.map((s) => <option key={s} value={s}>{OUTGOING_TYPE_LABELS[s]}</option>)}</Select></Field>
          <div className="sm:col-span-4"><Button type="submit"><Search className="h-4 w-4" /> Terapkan</Button></div>
        </form>
      </Card>
      <Card bodyClassName="p-0">
        {q.isLoading ? <Spinner /> : q.isError ? <div className="p-4"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div> : q.data && q.data.items.length === 0 ? (
          <EmptyState title="Belum ada surat keluar" />
        ) : q.data ? (
          <>
            <DataTable columns={columns} rows={q.data.items} onRowClick={(r) => navigate(`/surat-keluar/${r.id}`)} />
            <Pagination meta={q.data.meta} onPage={(p) => setParams({ ...Object.fromEntries(params), page: String(p) })} />
          </>
        ) : null}
      </Card>
    </div>
  );
}
