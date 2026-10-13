import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PRIORITIES, PRIORITY_LABELS, dispositionCreateSchema } from '@sisurat/shared';
import { api } from '../../lib/api';
import { formatDate, isOverdue, todayIso } from '../../lib/format';
import type { LetterDetail, LetterListItem, Paged, UserRef, AssignmentInfo } from '../../types/api';
import { Button, Card, DataTable, DescriptionList, EmptyState, ErrorState, Field, Input, PageHeader, Pagination, Select, Spinner, StatusBadge, Tabs, Textarea, useToast, type Column } from '../../components/ui';
import { DocumentViewer } from '../incoming-letters/components';
import { useLetterColumns } from '../incoming-letters/LetterListPage';

const QUICK_INSTRUCTIONS = ['Untuk diketahui', 'Tindak lanjuti sesuai ketentuan', 'Hadiri dan laporkan hasilnya', 'Siapkan bahan / jawaban', 'Koordinasikan dengan unit terkait', 'Arsipkan'];

type FormValues = z.input<typeof dispositionCreateSchema>;

export function DispositionCreatePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const letter = useQuery({ queryKey: ['letter', id], queryFn: () => api.get<LetterDetail>(`/incoming-letters/${id}`) });
  const staff = useQuery({ queryKey: ['directory', 'STAFF'], queryFn: () => api.get<{ items: (UserRef & { unit: { name: string } | null })[] }>('/users/directory', { role: 'STAFF' }) });
  const form = useForm<FormValues>({ resolver: zodResolver(dispositionCreateSchema), defaultValues: { instruction: '', priority: 'NORMAL', dueDate: '', assigneeIds: [] } });
  const m = useMutation({
    mutationFn: (v: FormValues) => api.post(`/incoming-letters/${id}/dispositions`, v),
    onSuccess: () => {
      toast.success('Disposisi dikirim ke pelaksana');
      qc.invalidateQueries({ queryKey: ['letter', id] });
      navigate(`/surat-masuk/${id}`);
    },
    onError: (e) => toast.error(e),
  });

  if (letter.isLoading) return <Spinner />;
  if (letter.isError || !letter.data) return <ErrorState error={letter.error} />;
  const l = letter.data;
  const errors = form.formState.errors;

  return (
    <div>
      <PageHeader
        title="Beri disposisi"
        description={`${l.agendaNumber ?? ''} — ${l.subject ?? ''}`}
        breadcrumbs={[{ label: 'Disposisi', to: '/disposisi' }, { label: l.agendaNumber ?? 'Surat', to: `/surat-masuk/${id}` }, { label: 'Disposisi' }]}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <Card title="Ringkasan surat">
            <DescriptionList
              items={[
                { label: 'Pengirim', value: l.senderName },
                { label: 'Nomor / tanggal', value: `${l.letterNumber ?? '-'} · ${formatDate(l.letterDate)}` },
                { label: 'Perihal', value: l.subject, wide: true },
                { label: 'Ringkasan', value: l.summary, wide: true },
                { label: 'Kegiatan', value: l.eventDate ? `${formatDate(l.eventDate)} · ${l.eventLocation ?? ''}` : null },
              ]}
            />
          </Card>
          <DocumentViewer documents={l.documents} />
        </div>
        <Card title="Arahan dan penugasan">
          {!l.actions.dispose ? (
            <p className="text-sm text-slate-600">Surat belum dapat didisposisikan (status: <StatusBadge kind="letter" value={l.status} />).</p>
          ) : (
            <form onSubmit={form.handleSubmit((v) => m.mutate(v))} className="space-y-4" noValidate>
              <Field label="Arahan / instruksi" required error={errors.instruction?.message}>
                <Textarea rows={5} {...form.register('instruction')} />
              </Field>
              <div className="flex flex-wrap gap-1">
                {QUICK_INSTRUCTIONS.map((t) => (
                  <button key={t} type="button" className="rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:border-brand-500 hover:text-brand-700" onClick={() => form.setValue('instruction', form.getValues('instruction') ? `${form.getValues('instruction')}\n${t}` : t, { shouldValidate: true })}>
                    + {t}
                  </button>
                ))}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Prioritas">
                  <Select {...form.register('priority')}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}</Select>
                </Field>
                <Field label="Tenggat" error={errors.dueDate?.message as string | undefined}>
                  <Input type="date" min={todayIso()} {...form.register('dueDate')} />
                </Field>
              </div>
              <Controller
                control={form.control}
                name="assigneeIds"
                render={({ field }) => (
                  <fieldset>
                    <legend className="text-sm font-medium text-slate-700">Pelaksana <span className="text-red-600">*</span></legend>
                    {errors.assigneeIds && <p role="alert" className="text-xs text-red-600">{errors.assigneeIds.message}</p>}
                    <div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
                      {staff.data?.items.length === 0 && <p className="text-sm text-slate-500">Belum ada pegawai pelaksana.</p>}
                      {staff.data?.items.map((u) => (
                        <label key={u.id} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-slate-50">
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-700"
                            checked={field.value?.includes(u.id) ?? false}
                            onChange={(e) => field.onChange(e.target.checked ? [...(field.value ?? []), u.id] : (field.value ?? []).filter((x) => x !== u.id))}
                          />
                          <span className="text-sm">
                            {u.fullName}
                            <span className="block text-xs text-slate-500">{[u.position, u.unit?.name].filter(Boolean).join(' · ')}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
              />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => navigate(`/surat-masuk/${id}`)}>Batal</Button>
                <Button type="submit" loading={m.isPending}>Kirim disposisi</Button>
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}

interface AssignmentRow extends Pick<AssignmentInfo, 'id' | 'status' | 'progressPercent' | 'dueDate' | 'assignee' | 'createdAt'> {
  disposition: { id: string; instruction: string; priority: string; issuer: UserRef; incomingLetter: { id: string; agendaNumber: string | null; subject: string | null; senderName: string | null } };
}

export function useAssignmentColumns(showAssignee: boolean): Column<AssignmentRow>[] {
  return [
    {
      header: 'Surat',
      className: 'min-w-[14rem]',
      cell: (r) => (
        <div>
          <Link to={`/tugas/${r.id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>{r.disposition.incomingLetter.subject ?? '-'}</Link>
          <p className="text-xs text-slate-500">{r.disposition.incomingLetter.agendaNumber} · {r.disposition.incomingLetter.senderName}</p>
        </div>
      ),
    },
    { header: 'Arahan', hideOnMobile: true, cell: (r) => <p className="line-clamp-2 max-w-xs text-xs">{r.disposition.instruction}</p> },
    ...(showAssignee ? [{ header: 'Pelaksana', cell: (r: AssignmentRow) => <span className="text-xs">{r.assignee.fullName}</span> }] : [{ header: 'Dari', hideOnMobile: true, cell: (r: AssignmentRow) => <span className="text-xs">{r.disposition.issuer.fullName}</span> }]),
    { header: 'Status', cell: (r) => <div className="flex flex-col items-start gap-1"><StatusBadge kind="assignment" value={r.status} /><span className="text-[11px] text-slate-500">{r.progressPercent}%</span></div> },
    { header: 'Tenggat', cell: (r) => <span className={isOverdue(r.dueDate, r.status) ? 'text-xs font-semibold text-red-600' : 'text-xs'}>{formatDate(r.dueDate)}{isOverdue(r.dueDate, r.status) && ' (terlambat)'}</span> },
  ];
}

export function DispositionInboxPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'menunggu' | 'periksa' | 'semua') ?? 'menunggu';
  const page = Number(params.get('page') ?? 1);
  const letterCols = useLetterColumns();
  const assignCols = useAssignmentColumns(true);
  const awaiting = useQuery({
    queryKey: ['letters', { status: 'AWAITING_DISPOSITION', page }],
    queryFn: () => api.get<Paged<LetterListItem>>('/incoming-letters', { status: 'AWAITING_DISPOSITION', page, sort: 'receivedDate', order: 'asc' }),
    enabled: tab === 'menunggu',
  });
  const review = useQuery({
    queryKey: ['assignments', 'review', tab, page],
    queryFn: () => api.get<Paged<AssignmentRow>>('/assignments', { scope: 'review', page, ...(tab === 'periksa' && { status: 'WAITING_REVIEW' }) }),
    enabled: tab !== 'menunggu',
  });
  const q = tab === 'menunggu' ? awaiting : review;
  return (
    <div>
      <PageHeader title="Disposisi" description="Surat yang menunggu arahan Anda dan hasil tindak lanjut yang perlu diperiksa." breadcrumbs={[{ label: 'Beranda', to: '/' }, { label: 'Disposisi' }]} />
      <Tabs
        value={tab}
        onChange={(v) => setParams({ tab: v })}
        tabs={[
          { value: 'menunggu', label: 'Menunggu disposisi' },
          { value: 'periksa', label: 'Menunggu pemeriksaan' },
          { value: 'semua', label: 'Semua penugasan dari saya' },
        ]}
      />
      <Card bodyClassName="p-0">
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <div className="p-4"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>
        ) : tab === 'menunggu' && awaiting.data ? (
          awaiting.data.items.length === 0 ? <EmptyState title="Tidak ada surat yang menunggu disposisi" /> : (
            <>
              <DataTable columns={letterCols} rows={awaiting.data.items} onRowClick={(r) => navigate(`/surat-masuk/${r.id}/disposisi`)} />
              <Pagination meta={awaiting.data.meta} onPage={(p) => setParams({ tab, page: String(p) })} />
            </>
          )
        ) : review.data ? (
          review.data.items.length === 0 ? <EmptyState title={tab === 'periksa' ? 'Tidak ada hasil yang menunggu pemeriksaan' : 'Belum ada penugasan'} /> : (
            <>
              <DataTable columns={assignCols} rows={review.data.items} onRowClick={(r) => navigate(`/tugas/${r.id}`)} />
              <Pagination meta={review.data.meta} onPage={(p) => setParams({ tab, page: String(p) })} />
            </>
          )
        ) : null}
      </Card>
    </div>
  );
}
