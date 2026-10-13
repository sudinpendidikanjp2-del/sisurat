import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, FileSearch, Inbox, Stamp, Timer, XCircle, Edit3, Cpu } from 'lucide-react';
import { LETTER_STATUS_LABELS, type LetterStatus } from '@sisurat/shared';
import { api } from '../../lib/api';
import { formatDate, todayIso } from '../../lib/format';
import { Card, EmptyState, ErrorState, Field, Input, PageHeader, Spinner, StatusBadge } from '../../components/ui';
import { useAuth } from '../auth/AuthContext';

interface Dashboard {
  period: { from: string; to: string };
  counts: Record<'totalIncoming' | 'awaitingVerification' | 'awaitingDisposition' | 'activeDispositions' | 'dueSoon' | 'overdue' | 'completed' | 'processingFailed' | 'corrections' | 'extractionJobs' | 'failedJobs', number>;
  averages: { registrationHours: number | null; completionHours: number | null };
  ai: { estimatedCostUsd: number | null; inputTokens: number | null; outputTokens: number | null };
  byStatus: { status: LetterStatus; count: number }[];
  mine: { activeAssignments: number; overdueAssignments: number };
  recent: { id: string; agendaNumber: string | null; subject: string | null; senderName: string | null; status: string; processingStatus: string; receivedDate: string }[];
}

function Stat({ label, value, icon: Icon, tone = 'text-brand-700', to }: { label: string; value: number | string; icon: typeof Inbox; tone?: string; to?: string }) {
  const body = (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-200">
      <div className={`rounded-md bg-slate-50 p-2 ${tone}`}>
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <div>
        <p className="text-2xl font-semibold text-slate-900">{value}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

const daysAgo = (n: number) => {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
};

export function DashboardPage() {
  const { user, can } = useAuth();
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(todayIso());
  const q = useQuery({ queryKey: ['dashboard', from, to], queryFn: () => api.get<Dashboard>('/dashboard', { dateFrom: from, dateTo: to }) });
  const d = q.data;
  const fmtHours = (h: number | null) => (h == null ? '-' : h < 24 ? `${h} jam` : `${(h / 24).toFixed(1)} hari`);

  return (
    <div>
      <PageHeader
        title={`Selamat datang, ${user?.fullName ?? ''}`}
        description="Ringkasan surat dan tindak lanjut berdasarkan data di sistem."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Dari">
              <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Sampai">
              <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
        }
      />
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : d ? (
        <div className="space-y-6">
          {can('assignment.work') && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Stat label="Tugas saya yang aktif" value={d.mine.activeAssignments} icon={Clock} to="/tugas" />
              <Stat label="Tugas saya terlambat" value={d.mine.overdueAssignments} icon={AlertTriangle} tone="text-red-600" to="/tugas?overdue=true" />
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Surat masuk (periode)" value={d.counts.totalIncoming} icon={Inbox} to="/surat-masuk" />
            <Stat label="Menunggu verifikasi" value={d.counts.awaitingVerification} icon={FileSearch} tone="text-amber-600" to="/surat-masuk?status=DRAFT" />
            <Stat label="Menunggu disposisi" value={d.counts.awaitingDisposition} icon={Stamp} tone="text-amber-600" to="/surat-masuk?status=AWAITING_DISPOSITION" />
            <Stat label="Disposisi aktif" value={d.counts.activeDispositions} icon={Clock} tone="text-indigo-600" />
            <Stat label="Tenggat mendekat" value={d.counts.dueSoon} icon={Timer} tone="text-orange-600" />
            <Stat label="Tugas terlambat" value={d.counts.overdue} icon={AlertTriangle} tone="text-red-600" />
            <Stat label="Selesai (periode)" value={d.counts.completed} icon={CheckCircle2} tone="text-emerald-600" />
            <Stat label="Gagal OCR/AI" value={d.counts.processingFailed} icon={XCircle} tone="text-red-600" to="/surat-masuk?processingStatus=PROCESSING_FAILED" />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Kinerja periode ini">
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">Rata-rata unggah → terdaftar</dt><dd className="font-medium">{fmtHours(d.averages.registrationHours)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Rata-rata terdaftar → selesai</dt><dd className="font-medium">{fmtHours(d.averages.completionHours)}</dd></div>
                <div className="flex justify-between"><dt className="flex items-center gap-1 text-slate-500"><Edit3 className="h-3.5 w-3.5" />Koreksi metadata</dt><dd className="font-medium">{d.counts.corrections}</dd></div>
                <div className="flex justify-between"><dt className="flex items-center gap-1 text-slate-500"><Cpu className="h-3.5 w-3.5" />Job ekstraksi (gagal)</dt><dd className="font-medium">{d.counts.extractionJobs} ({d.counts.failedJobs})</dd></div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Estimasi biaya AI</dt>
                  <dd className="font-medium">{d.ai.estimatedCostUsd != null ? `US$${d.ai.estimatedCostUsd.toFixed(4)}` : 'Belum tersedia'}</dd>
                </div>
              </dl>
              {d.ai.estimatedCostUsd == null && <p className="mt-3 text-xs text-slate-500">Biaya dihitung bila provider mengembalikan data token dan tarif telah diisi admin.</p>}
            </Card>
            <Card title="Status surat (periode)">
              {d.byStatus.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">Belum ada surat pada periode ini.</p>
              ) : (
                <ul className="space-y-2">
                  {d.byStatus.map((s) => {
                    const pct = Math.round((s.count / Math.max(1, d.counts.totalIncoming)) * 100);
                    return (
                      <li key={s.status}>
                        <div className="flex justify-between text-xs"><span>{LETTER_STATUS_LABELS[s.status]}</span><span className="font-medium">{s.count}</span></div>
                        <div className="mt-1 h-1.5 rounded bg-slate-100"><div className="h-1.5 rounded bg-brand-600" style={{ width: `${pct}%` }} /></div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
            <Card title="Surat terbaru" bodyClassName="p-0">
              {d.recent.length === 0 ? (
                <EmptyState title="Belum ada surat" description="Surat yang diunggah akan tampil di sini." />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {d.recent.map((r) => (
                    <li key={r.id}>
                      <Link to={`/surat-masuk/${r.id}`} className="block px-4 py-2.5 hover:bg-slate-50">
                        <p className="truncate text-sm font-medium text-slate-800">{r.subject ?? '(belum ada perihal)'}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span>{r.agendaNumber ?? 'Draft'}</span>
                          <span>·</span>
                          <span>{formatDate(r.receivedDate)}</span>
                          <StatusBadge kind="letter" value={r.status} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}
