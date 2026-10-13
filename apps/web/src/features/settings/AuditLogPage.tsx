import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { Paged } from '../../types/api';
import { Button, Card, DataTable, Dialog, EmptyState, ErrorState, Field, Input, PageHeader, Pagination, Select, Spinner, type Column } from '../../components/ui';
import { actionLabel } from '../../components/HistoryList';

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  actor: { id: string; fullName: string; username: string } | null;
}

const ENTITY_TYPES = ['IncomingLetter', 'Document', 'ExtractionJob', 'Disposition', 'Assignment', 'OutgoingLetter', 'DocumentTemplate', 'User', 'Role', 'AppSetting', 'AiProviderConfig', 'Report'];

export function AuditLogPage() {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AuditRow | null>(null);
  const q = useQuery({ queryKey: ['audit', filters, page], queryFn: () => api.get<Paged<AuditRow>>('/audit-logs', { ...filters, page, pageSize: 30 }), placeholderData: keepPreviousData });
  const columns: Column<AuditRow>[] = [
    { header: 'Waktu', cell: (r) => <span className="text-xs whitespace-nowrap">{formatDateTime(r.createdAt)}</span> },
    { header: 'Aktor', cell: (r) => <span className="text-xs">{r.actor ? `${r.actor.fullName} (${r.actor.username})` : 'Sistem'}</span> },
    { header: 'Aksi', cell: (r) => <div><p className="text-sm">{actionLabel(r.action)}</p><code className="text-[10px] text-slate-400">{r.action}</code></div> },
    { header: 'Objek', hideOnMobile: true, cell: (r) => <span className="text-xs">{r.entityType}{r.entityId ? ` · ${r.entityId.slice(0, 10)}…` : ''}</span> },
    { header: 'Keterangan', hideOnMobile: true, cell: (r) => <span className="line-clamp-2 text-xs text-slate-600">{r.summary ?? ''}</span> },
    { header: 'IP', hideOnMobile: true, cell: (r) => <span className="text-xs text-slate-500">{r.ip ?? '-'}</span> },
  ];
  return (
    <div>
      <PageHeader title="Audit Log" description="Jejak aktor, waktu, aksi, objek, dan perubahan penting. Isi surat lengkap tidak disimpan di log." breadcrumbs={[{ label: 'Administrasi' }, { label: 'Audit Log' }]} />
      <Card className="mb-4">
        <form className="grid gap-3 sm:grid-cols-5" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); setFilters(Object.fromEntries([...fd.entries()].filter(([, v]) => v).map(([k, v]) => [k, String(v)]))); setPage(1); }}>
          <Field label="Aksi"><Input name="action" placeholder="mis. letter.verified" /></Field>
          <Field label="Jenis objek"><Select name="entityType"><option value="">Semua</option>{ENTITY_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="ID objek"><Input name="entityId" /></Field>
          <Field label="Dari"><Input type="date" name="dateFrom" /></Field>
          <Field label="Sampai"><Input type="date" name="dateTo" /></Field>
          <div className="sm:col-span-5"><Button type="submit"><Search className="h-4 w-4" /> Filter</Button></div>
        </form>
      </Card>
      <Card bodyClassName="p-0">
        {q.isLoading ? <Spinner /> : q.isError ? <div className="p-4"><ErrorState error={q.error} /></div> : q.data && q.data.items.length === 0 ? <EmptyState title="Tidak ada entri" /> : q.data ? (
          <><DataTable columns={columns} rows={q.data.items} onRowClick={setDetail} /><Pagination meta={q.data.meta} onPage={setPage} /></>
        ) : null}
      </Card>
      <Dialog open={!!detail} onClose={() => setDetail(null)} title="Detail audit" wide>
        {detail && (
          <div className="space-y-3 text-xs">
            <p><strong>{actionLabel(detail.action)}</strong> · {formatDateTime(detail.createdAt)} · {detail.actor?.fullName ?? 'Sistem'}</p>
            <p>Objek: {detail.entityType} {detail.entityId}</p>
            {detail.userAgent && <p className="text-slate-500">Perangkat: {detail.userAgent}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <div><p className="mb-1 font-medium">Sebelum</p><pre className="max-h-80 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(detail.before, null, 2) ?? '-'}</pre></div>
              <div><p className="mb-1 font-medium">Sesudah</p><pre className="max-h-80 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(detail.after, null, 2) ?? '-'}</pre></div>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
