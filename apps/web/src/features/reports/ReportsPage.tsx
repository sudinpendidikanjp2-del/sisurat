import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Search } from 'lucide-react';
import { EXTRACTION_METHOD_LABELS, LETTER_STATUSES, LETTER_STATUS_LABELS, LETTER_TYPES, LETTER_TYPE_LABELS, type ExtractionMethod, type LetterStatus, type LetterType } from '@sisurat/shared';
import { api, toQueryString } from '../../lib/api';
import type { UserRef } from '../../types/api';
import { Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Select, Spinner } from '../../components/ui';
import { useAuth } from '../auth/AuthContext';

interface Report {
  total: number;
  truncated: boolean;
  byStatus: { status: LetterStatus; count: number }[];
  byType: { type: LetterType | 'TIDAK_DIISI'; count: number }[];
  topSenders: { sender: string; count: number }[];
  byAssignee: { name: string; total: number; completed: number; overdue: number }[];
  processing: { method: ExtractionMethod | null; provider: string | null; status: string; count: number; inputTokens: number | null; outputTokens: number | null; pages: number | null; estimatedCostUsd: number | null; avgDurationMs: number | null }[];
  corrections: { field: string; count: number }[];
  averages: { registrationHours: number | null; completionHours: number | null };
}

function Bars({ rows }: { rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length) return <p className="py-4 text-center text-sm text-slate-500">Tidak ada data</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex justify-between gap-2 text-xs"><span className="truncate">{r.label}</span><span className="font-medium">{r.count}</span></div>
          <div className="mt-1 h-1.5 rounded bg-slate-100"><div className="h-1.5 rounded bg-brand-600" style={{ width: `${(r.count / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

export function ReportsPage() {
  const { can } = useAuth();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const staff = useQuery({ queryKey: ['directory', 'STAFF'], queryFn: () => api.get<{ items: UserRef[] }>('/users/directory', { role: 'STAFF' }) });
  const q = useQuery({ queryKey: ['report', filters], queryFn: () => api.get<Report>('/reports/letters', filters) });
  const r = q.data;
  return (
    <div>
      <PageHeader
        title="Laporan"
        description="Rekapitulasi register surat, tindak lanjut, koreksi metadata, dan pemrosesan OCR/AI."
        breadcrumbs={[{ label: 'Beranda', to: '/' }, { label: 'Laporan' }]}
        actions={can('report.export') ? <a href={`/api/reports/letters.csv${toQueryString(filters)}`}><Button variant="secondary"><Download className="h-4 w-4" /> Ekspor CSV</Button></a> : undefined}
      />
      <Card className="mb-4">
        <form
          className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            setFilters(Object.fromEntries([...fd.entries()].filter(([, v]) => v).map(([k, v]) => [k, String(v)])));
          }}
        >
          <Field label="Diterima dari"><Input type="date" name="dateFrom" /></Field>
          <Field label="Sampai"><Input type="date" name="dateTo" /></Field>
          <Field label="Status"><Select name="status"><option value="">Semua</option>{LETTER_STATUSES.map((s) => <option key={s} value={s}>{LETTER_STATUS_LABELS[s]}</option>)}</Select></Field>
          <Field label="Kategori/jenis"><Select name="letterType"><option value="">Semua</option>{LETTER_TYPES.map((s) => <option key={s} value={s}>{LETTER_TYPE_LABELS[s]}</option>)}</Select></Field>
          <Field label="Pengirim"><Input name="sender" /></Field>
          <Field label="Penanggung jawab"><Select name="assigneeId"><option value="">Semua</option>{staff.data?.items.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</Select></Field>
          <div className="sm:col-span-3 lg:col-span-6"><Button type="submit"><Search className="h-4 w-4" /> Tampilkan</Button></div>
        </form>
      </Card>
      {q.isLoading ? <Spinner /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : r && r.total === 0 ? (
        <Card><EmptyState title="Tidak ada surat pada filter ini" /></Card>
      ) : r ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Ringkasan">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Jumlah surat</dt><dd className="font-semibold">{r.total}{r.truncated && '+'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Rata-rata waktu registrasi</dt><dd>{r.averages.registrationHours != null ? `${r.averages.registrationHours} jam` : '-'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Rata-rata waktu tindak lanjut</dt><dd>{r.averages.completionHours != null ? `${r.averages.completionHours} jam` : '-'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Total koreksi metadata</dt><dd>{r.corrections.reduce((a, c) => a + c.count, 0)}</dd></div>
            </dl>
          </Card>
          <Card title="Per status"><Bars rows={r.byStatus.map((s) => ({ label: LETTER_STATUS_LABELS[s.status], count: s.count }))} /></Card>
          <Card title="Per jenis"><Bars rows={r.byType.map((s) => ({ label: s.type === 'TIDAK_DIISI' ? 'Tidak diisi' : LETTER_TYPE_LABELS[s.type], count: s.count }))} /></Card>
          <Card title="Pengirim terbanyak"><Bars rows={r.topSenders.map((s) => ({ label: s.sender, count: s.count }))} /></Card>
          <Card title="Koreksi per field"><Bars rows={r.corrections.map((c) => ({ label: c.field, count: c.count }))} /></Card>
          <Card title="Penanggung jawab" bodyClassName="p-0">
            {r.byAssignee.length === 0 ? <p className="p-4 text-center text-sm text-slate-500">Belum ada penugasan</p> : (
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-3 py-2">Nama</th><th className="px-3 py-2 text-right">Tugas</th><th className="px-3 py-2 text-right">Selesai</th><th className="px-3 py-2 text-right">Terlambat</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{r.byAssignee.map((a) => <tr key={a.name}><td className="px-3 py-2">{a.name}</td><td className="px-3 py-2 text-right">{a.total}</td><td className="px-3 py-2 text-right">{a.completed}</td><td className={`px-3 py-2 text-right ${a.overdue ? 'font-semibold text-red-600' : ''}`}>{a.overdue}</td></tr>)}</tbody>
              </table>
            )}
          </Card>
          <Card title="Pemrosesan OCR / AI & estimasi biaya" className="lg:col-span-3" bodyClassName="p-0">
            {r.processing.length === 0 ? <p className="p-4 text-center text-sm text-slate-500">Belum ada job ekstraksi</p> : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-3 py-2">Metode</th><th className="px-3 py-2">Provider</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Job</th><th className="px-3 py-2 text-right">Halaman</th><th className="px-3 py-2 text-right">Token in/out</th><th className="px-3 py-2 text-right">Rata-rata durasi</th><th className="px-3 py-2 text-right">Estimasi biaya</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {r.processing.map((p, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2">{p.method ? EXTRACTION_METHOD_LABELS[p.method] : '-'}</td>
                        <td className="px-3 py-2">{p.provider ?? '-'}</td>
                        <td className="px-3 py-2">{p.status}</td>
                        <td className="px-3 py-2 text-right">{p.count}</td>
                        <td className="px-3 py-2 text-right">{p.pages ?? '-'}</td>
                        <td className="px-3 py-2 text-right">{p.inputTokens ?? '-'} / {p.outputTokens ?? '-'}</td>
                        <td className="px-3 py-2 text-right">{p.avgDurationMs != null ? `${(p.avgDurationMs / 1000).toFixed(1)} dtk` : '-'}</td>
                        <td className="px-3 py-2 text-right">{p.estimatedCostUsd != null ? `US$${p.estimatedCostUsd.toFixed(4)}` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
