import { useNavigate, useSearchParams, Link } from 'react-router';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, Search, Paperclip, SlidersHorizontal, X } from 'lucide-react';
import {
  LETTER_STATUSES,
  LETTER_STATUS_LABELS,
  LETTER_TYPES,
  LETTER_TYPE_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  PROCESSING_STATUSES,
  PROCESSING_STATUS_LABELS,
} from '@sisurat/shared';
import { api } from '../../lib/api';
import { formatDate, isOverdue } from '../../lib/format';
import type { LetterListItem, Paged } from '../../types/api';
import { Button, Card, DataTable, EmptyState, ErrorState, Field, Input, PageHeader, Pagination, Select, Spinner, StatusBadge, type Column } from '../../components/ui';
import { useAuth } from '../auth/AuthContext';

const FILTER_KEYS = ['q', 'status', 'processingStatus', 'letterType', 'priority', 'sender', 'dateFrom', 'dateTo'] as const;

export function useLetterColumns(): Column<LetterListItem>[] {
  return [
    {
      header: 'No. Agenda',
      cell: (r) => (
        <div>
          <p className="font-medium text-slate-900">{r.agendaNumber ?? <span className="text-slate-400 italic">Draft</span>}</p>
          <p className="text-xs text-slate-500">{formatDate(r.receivedDate)}</p>
        </div>
      ),
    },
    {
      header: 'Perihal / Pengirim',
      className: 'min-w-[16rem]',
      cell: (r) => (
        <div>
          <Link to={`/surat-masuk/${r.id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
            {r.subject ?? <span className="text-slate-400 italic">(belum ada perihal)</span>}
          </Link>
          <p className="text-xs text-slate-500">
            {r.senderName ?? '-'} · No. {r.letterNumber ?? '-'} · {formatDate(r.letterDate)}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {r.letterType && <span className="text-[11px] text-slate-500">{LETTER_TYPE_LABELS[r.letterType]}</span>}
            {r.documentCount > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-slate-500">
                <Paperclip className="h-3 w-3" />
                {r.documentCount}
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      header: 'Status',
      cell: (r) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge kind="letter" value={r.status} />
          {r.status === 'DRAFT' && <StatusBadge kind="processing" value={r.processingStatus} />}
        </div>
      ),
    },
    { header: 'Prioritas', hideOnMobile: true, cell: (r) => <StatusBadge kind="priority" value={r.priority} /> },
    {
      header: 'Penanggung jawab',
      hideOnMobile: true,
      cell: (r) =>
        r.assignees.length ? (
          <div className="text-xs">
            {r.assignees.map((a) => <p key={a.id}>{a.fullName}</p>)}
            {r.dueDate && <p className={isOverdue(r.dueDate, r.status) ? 'font-medium text-red-600' : 'text-slate-500'}>Tenggat {formatDate(r.dueDate)}</p>}
          </div>
        ) : r.forwardedTo ? (
          <span className="text-xs text-slate-500">Di {r.forwardedTo.fullName}</span>
        ) : (
          <span className="text-slate-400">-</span>
        ),
    },
    { header: 'Pencatat', hideOnMobile: true, cell: (r) => <span className="text-xs">{r.createdBy.fullName}</span> },
  ];
}

export function LetterListPage({ archived = false }: { archived?: boolean }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as Record<(typeof FILTER_KEYS)[number], string>;
  const query = { ...filters, page, pageSize: 20, archived: archived ? 'true' : filters.status ? undefined : 'false' };

  const q = useQuery({
    queryKey: ['letters', query],
    queryFn: () => api.get<Paged<LetterListItem>>('/incoming-letters', query),
    placeholderData: keepPreviousData,
  });
  const columns = useLetterColumns();

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  const hasFilters = FILTER_KEYS.some((k) => filters[k]);
  const advancedActive = FILTER_KEYS.some((k) => k !== 'q' && filters[k]);
  const [showFilters, setShowFilters] = useState(advancedActive);

  return (
    <div>
      <PageHeader
        title={archived ? 'Arsip Surat' : 'Surat Masuk'}
        description={archived ? 'Surat yang telah selesai dan diarsipkan.' : 'Register surat masuk, status verifikasi, disposisi, dan tindak lanjut.'}
        breadcrumbs={[{ label: 'Beranda', to: '/' }, { label: archived ? 'Arsip' : 'Surat Masuk' }]}
        actions={
          !archived && can('letter.create') ? (
            <Button onClick={() => navigate('/surat-masuk/baru')}>
              <Plus className="h-4 w-4" /> Unggah surat
            </Button>
          ) : undefined
        }
      />
      <Card className="mb-4">
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            update(Object.fromEntries(FILTER_KEYS.map((k) => [k, String(fd.get(k) ?? '')])));
          }}
        >
          <Field label="Cari" className="sm:col-span-2 lg:col-span-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-slate-400" aria-hidden />
              <Input name="q" defaultValue={filters.q} placeholder="Perihal, nomor surat, nomor agenda, pengirim…" className="pl-8" />
            </div>
          </Field>
          <div className="flex items-end lg:hidden">
            <Button variant="secondary" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
              <SlidersHorizontal className="h-4 w-4" /> {showFilters ? 'Sembunyikan filter' : 'Filter lainnya'}
            </Button>
          </div>
          <div className={`${showFilters ? 'grid' : 'hidden'} grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-2 lg:col-span-4 lg:grid lg:grid-cols-4`}>
          {!archived && (
            <Field label="Status">
              <Select name="status" defaultValue={filters.status}>
                <option value="">Semua (aktif)</option>
                {LETTER_STATUSES.filter((s) => s !== 'ARCHIVED').map((s) => <option key={s} value={s}>{LETTER_STATUS_LABELS[s]}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Status OCR/AI">
            <Select name="processingStatus" defaultValue={filters.processingStatus}>
              <option value="">Semua</option>
              {PROCESSING_STATUSES.map((s) => <option key={s} value={s}>{PROCESSING_STATUS_LABELS[s]}</option>)}
            </Select>
          </Field>
          <Field label="Jenis">
            <Select name="letterType" defaultValue={filters.letterType}>
              <option value="">Semua</option>
              {LETTER_TYPES.map((s) => <option key={s} value={s}>{LETTER_TYPE_LABELS[s]}</option>)}
            </Select>
          </Field>
          <Field label="Prioritas">
            <Select name="priority" defaultValue={filters.priority}>
              <option value="">Semua</option>
              {PRIORITIES.map((s) => <option key={s} value={s}>{PRIORITY_LABELS[s]}</option>)}
            </Select>
          </Field>
          <Field label="Pengirim">
            <Input name="sender" defaultValue={filters.sender} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Diterima dari">
              <Input type="date" name="dateFrom" defaultValue={filters.dateFrom} />
            </Field>
            <Field label="Sampai">
              <Input type="date" name="dateTo" defaultValue={filters.dateTo} />
            </Field>
          </div>
          </div>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <Button type="submit">
              <Search className="h-4 w-4" /> Terapkan
            </Button>
            {hasFilters && (
              <Button variant="ghost" onClick={() => setParams({}, { replace: true })}>
                <X className="h-4 w-4" /> Reset filter
              </Button>
            )}
          </div>
        </form>
      </Card>
      <Card bodyClassName="p-0">
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <div className="p-4"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>
        ) : q.data && q.data.items.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'Tidak ada surat yang cocok' : archived ? 'Arsip masih kosong' : 'Belum ada surat masuk'}
            description={hasFilters ? 'Ubah atau reset filter pencarian.' : !archived && can('letter.create') ? 'Unggah surat pertama untuk memulai.' : undefined}
          />
        ) : q.data ? (
          <>
            <DataTable caption="Daftar surat masuk" columns={columns} rows={q.data.items} onRowClick={(r) => navigate(`/surat-masuk/${r.id}`)} />
            <Pagination meta={q.data.meta} onPage={(p) => update({ page: String(p) })} />
          </>
        ) : null}
      </Card>
    </div>
  );
}
