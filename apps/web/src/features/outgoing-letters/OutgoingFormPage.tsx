import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FileText, Search, X } from 'lucide-react';
import { CONFIDENTIALITY_LABELS, CONFIDENTIALITY_LEVELS, OUTGOING_TYPES, OUTGOING_TYPE_LABELS, type OutgoingType, type PlaceholderDef } from '@sisurat/shared';
import { api, ApiError } from '../../lib/api';
import type { LetterListItem, Paged, TemplateInfo } from '../../types/api';
import { Alert, Badge, Button, Card, ErrorState, Field, Input, PageHeader, Select, Spinner, Textarea, useToast } from '../../components/ui';

interface OutgoingDetailLite {
  id: string;
  type: OutgoingType;
  subject: string;
  recipient: string;
  confidentiality: string;
  data: Record<string, string>;
  dispositionId: string | null;
  template: { id: string; name: string; version: number; placeholders: PlaceholderDef[] };
  links: { incomingLetter: { id: string; agendaNumber: string | null; subject: string | null } }[];
}

type LinkRef = { id: string; agendaNumber: string | null; subject: string | null };

function LinkedLetters({ value, onChange }: { value: LinkRef[]; onChange: (v: LinkRef[]) => void }) {
  const [term, setTerm] = useState('');
  const search = useQuery({
    queryKey: ['letters', 'link-search', term],
    queryFn: () => api.get<Paged<LetterListItem>>('/incoming-letters', { q: term, pageSize: 8, archived: undefined }),
    enabled: term.trim().length >= 2,
  });
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((l) => (
            <li key={l.id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs text-brand-800">
              {l.agendaNumber ?? 'Draft'} — {l.subject?.slice(0, 40)}
              <button type="button" aria-label="Hapus tautan" onClick={() => onChange(value.filter((x) => x.id !== l.id))}><X className="h-3 w-3" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-slate-400" aria-hidden />
        <Input className="pl-8" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Cari surat masuk untuk ditautkan (nomor agenda / perihal)…" aria-label="Cari surat masuk" />
      </div>
      {search.data && term.trim().length >= 2 && (
        <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
          {search.data.items.filter((l) => l.agendaNumber && !value.some((v) => v.id === l.id)).map((l) => (
            <li key={l.id}>
              <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { onChange([...value, { id: l.id, agendaNumber: l.agendaNumber, subject: l.subject }]); setTerm(''); }}>
                <span className="font-medium">{l.agendaNumber}</span> — {l.subject}
              </button>
            </li>
          ))}
          {search.data.items.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Tidak ditemukan</li>}
        </ul>
      )}
    </div>
  );
}

export function OutgoingFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [type, setType] = useState<OutgoingType>('UNDANGAN');
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [recipient, setRecipient] = useState('');
  const [confidentiality, setConfidentiality] = useState('BIASA');
  const [data, setData] = useState<Record<string, string>>({});
  const [links, setLinks] = useState<LinkRef[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dispositionId = params.get('disposition');

  const existing = useQuery({ queryKey: ['outgoing', id, 'edit'], queryFn: () => api.get<OutgoingDetailLite>(`/outgoing-letters/${id}`), enabled: editing });
  const templates = useQuery({ queryKey: ['templates', 'active'], queryFn: () => api.get<{ items: TemplateInfo[] }>('/templates', { active: 'true' }) });
  const incomingId = params.get('incoming');
  const incoming = useQuery({
    queryKey: ['letter', incomingId],
    queryFn: () => api.get<{ id: string; agendaNumber: string | null; subject: string | null; senderName: string | null }>(`/incoming-letters/${incomingId}`),
    enabled: !!incomingId && !editing,
  });

  useEffect(() => {
    if (incoming.data && links.length === 0) {
      setLinks([{ id: incoming.data.id, agendaNumber: incoming.data.agendaNumber, subject: incoming.data.subject }]);
      if (!recipient && incoming.data.senderName) setRecipient(incoming.data.senderName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming.data]);

  useEffect(() => {
    const e = existing.data;
    if (!e) return;
    setType(e.type);
    setTemplateId(e.template.id);
    setSubject(e.subject);
    setRecipient(e.recipient);
    setConfidentiality(e.confidentiality);
    setData(e.data);
    setLinks(e.links.map((l) => l.incomingLetter));
  }, [existing.data]);

  const byType = useMemo(() => (templates.data?.items ?? []).filter((t) => t.type === type), [templates.data, type]);
  useEffect(() => {
    if (!editing && byType.length && !byType.some((t) => t.id === templateId)) setTemplateId(byType[0].id);
  }, [byType, templateId, editing]);

  const template: { placeholders: PlaceholderDef[]; name: string; version: number; isSample?: boolean } | undefined = editing ? existing.data?.template : byType.find((t) => t.id === templateId);

  const save = useMutation({
    mutationFn: () => {
      const body = { subject, recipient, confidentiality, data, incomingLetterIds: links.map((l) => l.id) };
      return editing
        ? api.patch<{ id: string }>(`/outgoing-letters/${id}`, body)
        : api.post<{ id: string }>('/outgoing-letters', { ...body, templateId, dispositionId });
    },
    onSuccess: (r) => {
      toast.success(editing ? 'Draft diperbarui (versi dokumen baru dibuat)' : 'Draft surat dibuat dari templat');
      navigate(`/surat-keluar/${r.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toast.error(e);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (subject.trim().length < 3) errs.subject = 'Perihal minimal 3 karakter';
    if (recipient.trim().length < 2) errs.recipient = 'Tujuan wajib diisi';
    for (const p of template?.placeholders ?? []) if (p.required && !(data[p.key] ?? '').trim()) errs[`data.${p.key}`] = `${p.label} wajib diisi`;
    setErrors(errs);
    if (Object.keys(errs).length === 0) save.mutate();
  };

  if (editing && existing.isLoading) return <Spinner />;
  if (editing && existing.isError) return <ErrorState error={existing.error} />;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={editing ? 'Ubah draft surat keluar' : 'Buat surat keluar'}
        description="Isi data surat; sistem mengisi placeholder templat DOCX. Surat belum sah sebelum diperiksa, disetujui, dan difinalkan."
        breadcrumbs={[{ label: 'Surat Keluar', to: '/surat-keluar' }, { label: editing ? 'Ubah' : 'Baru' }]}
      />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Card title="Templat">
          {templates.isLoading ? <Spinner /> : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Jenis surat" required>
                <Select value={type} onChange={(e) => setType(e.target.value as OutgoingType)} disabled={editing}>
                  {OUTGOING_TYPES.map((t) => <option key={t} value={t}>{OUTGOING_TYPE_LABELS[t]}</option>)}
                </Select>
              </Field>
              <Field label="Templat" required>
                <Select value={templateId} onChange={(e) => { setTemplateId(e.target.value); setData({}); }} disabled={editing}>
                  {editing && existing.data && <option value={existing.data.template.id}>{existing.data.template.name} (v{existing.data.template.version})</option>}
                  {!editing && byType.map((t) => <option key={t.id} value={t.id}>{t.name} (v{t.version})</option>)}
                </Select>
              </Field>
              {!editing && byType.length === 0 && <div className="sm:col-span-2"><Alert tone="warning">Belum ada templat aktif untuk jenis ini. Minta administrator mengunggah templat resmi.</Alert></div>}
              {template?.isSample && <div className="sm:col-span-2"><Alert tone="warning">Templat ini adalah CONTOH pengembangan, bukan templat resmi organisasi.</Alert></div>}
            </div>
          )}
        </Card>
        <Card title="Data surat">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Perihal" required error={errors.subject} className="sm:col-span-2"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
            <Field label="Tujuan / penerima" required error={errors.recipient}><Input value={recipient} onChange={(e) => setRecipient(e.target.value)} /></Field>
            <Field label="Klasifikasi"><Select value={confidentiality} onChange={(e) => setConfidentiality(e.target.value)}>{CONFIDENTIALITY_LEVELS.map((c) => <option key={c} value={c}>{CONFIDENTIALITY_LABELS[c]}</option>)}</Select></Field>
          </div>
          {template && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700"><FileText className="h-4 w-4" /> Isian templat <Badge>{template.placeholders.length} field</Badge></p>
              <div className="grid gap-4 sm:grid-cols-2">
                {template.placeholders.map((p) => (
                  <Field key={p.key} label={p.label} required={p.required} error={errors[`data.${p.key}`]} hint={<code className="text-[11px]">{`{${p.key}}`}</code>} className={p.multiline ? 'sm:col-span-2' : undefined}>
                    {p.multiline ? (
                      <Textarea rows={3} value={data[p.key] ?? ''} onChange={(e) => setData({ ...data, [p.key]: e.target.value })} />
                    ) : (
                      <Input value={data[p.key] ?? ''} onChange={(e) => setData({ ...data, [p.key]: e.target.value })} />
                    )}
                  </Field>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-500">Nomor surat dan nama instansi diisi otomatis oleh sistem saat finalisasi.</p>
            </div>
          )}
        </Card>
        <Card title="Relasi ke surat masuk">
          <LinkedLetters value={links} onChange={setLinks} />
          {dispositionId && <p className="mt-2 text-xs text-slate-500">Surat ini ditautkan ke disposisi asal.</p>}
        </Card>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => navigate(-1)}>Batal</Button>
          <Button type="submit" loading={save.isPending} disabled={!template}>{editing ? 'Simpan & buat versi baru' : 'Buat draft DOCX'}</Button>
        </div>
      </form>
    </div>
  );
}
