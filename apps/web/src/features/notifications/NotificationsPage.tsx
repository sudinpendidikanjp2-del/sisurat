import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { NotificationInfo, PageMeta } from '../../types/api';
import { Button, Card, EmptyState, ErrorState, PageHeader, Pagination, Spinner, Tabs } from '../../components/ui';
import { cn } from '../../lib/cn';

export function NotificationsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['notifications', tab, page],
    queryFn: () => api.get<{ items: NotificationInfo[]; unread: number; meta: PageMeta }>('/notifications', { page, unread: tab === 'unread' ? 'true' : undefined }),
  });
  const read = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  return (
    <div className="max-w-3xl">
      <PageHeader title="Notifikasi" breadcrumbs={[{ label: 'Beranda', to: '/' }, { label: 'Notifikasi' }]} actions={<Button variant="secondary" onClick={() => readAll.mutate()} loading={readAll.isPending}>Tandai semua dibaca</Button>} />
      <Tabs value={tab} onChange={(v) => { setTab(v); setPage(1); }} tabs={[{ value: 'all', label: 'Semua' }, { value: 'unread', label: 'Belum dibaca', count: q.data?.unread }]} />
      <Card bodyClassName="p-0">
        {q.isLoading ? <Spinner /> : q.isError ? <div className="p-4"><ErrorState error={q.error} /></div> : q.data && q.data.items.length === 0 ? <EmptyState title="Tidak ada notifikasi" /> : q.data ? (
          <>
            <ul className="divide-y divide-slate-100">
              {q.data.items.map((n) => (
                <li key={n.id}>
                  <button type="button" className={cn('block w-full px-4 py-3 text-left hover:bg-slate-50', !n.readAt && 'bg-brand-50/50')} onClick={() => { if (!n.readAt) read.mutate(n.id); if (n.link) navigate(n.link); }}>
                    <p className="text-sm font-medium text-slate-800">{!n.readAt && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-brand-600" aria-label="belum dibaca" />}{n.title}</p>
                    <p className="text-sm text-slate-600">{n.message}</p>
                    <p className="mt-0.5 text-xs text-slate-400">{formatDateTime(n.createdAt)}</p>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination meta={q.data.meta} onPage={setPage} />
          </>
        ) : null}
      </Card>
    </div>
  );
}
