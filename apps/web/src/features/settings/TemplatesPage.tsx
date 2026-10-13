import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Pencil, Upload } from 'lucide-react';
import { OUTGOING_TYPES, OUTGOING_TYPE_LABELS, type OutgoingType, type PlaceholderDef } from '@sisurat/shared';
import { api, documentUrl } from '../../lib/api';
import { formatDate } from '../../lib/format';
import type { TemplateInfo } from '../../types/api';
import { Alert, Badge, Button, Card, Checkbox, Dialog, EmptyState, ErrorState, Field, Input, PageHeader, Select, Spinner, useToast } from '../../components/ui';

function EditTemplateDialog({ t, onClose }: { t: TemplateInfo; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(t.name);
  const [approvedByName, setApproved] = useState(t.approvedByName ?? '');
  const [activeFrom, setActiveFrom] = useState(t.activeFrom?.slice(0, 10) ?? '');
  const [isActive, setActive] = useState(t.isActive);
  const [defs, setDefs] = useState<PlaceholderDef[]>(t.placeholders);
  const m = useMutation({
    mutationFn: () => api.patch(`/templates/${t.id}`, { name, approvedByName, activeFrom, isActive, placeholders: defs }),
    onSuccess: () => { toast.success('Templat diperbarui'); qc.invalidateQueries({ queryKey: ['templates'] }); onClose(); },
    onError: (e) => toast.error(e),
  });
  return (
    <Dialog open onClose={onClose} wide title={`${OUTGOING_TYPE_LABELS[t.type]} — versi ${t.version}`} footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Simpan</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Nama templat" className="sm:col-span-3"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Disetujui oleh"><Input value={approvedByName} onChange={(e) => setApproved(e.target.value)} /></Field>
          <Field label="Berlaku mulai"><Input type="date" value={activeFrom} onChange={(e) => setActiveFrom(e.target.value)} /></Field>
          <div className="flex items-end pb-2"><Checkbox label="Aktif" checked={isActive} onChange={(e) => setActive(e.target.checked)} /></div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Pemetaan placeholder</p>
          <div className="space-y-2">
            {defs.map((d, i) => (
              <div key={d.key} className="grid grid-cols-1 items-center gap-2 rounded border border-slate-200 p-2 sm:grid-cols-[10rem_1fr_auto_auto]">
                <code className="text-xs">{`{${d.key}}`}</code>
                <Input value={d.label} onChange={(e) => setDefs(defs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label={`Label ${d.key}`} />
                <Checkbox label="Wajib" checked={d.required} onChange={(e) => setDefs(defs.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} />
                <Checkbox label="Teks panjang" checked={d.multiline} onChange={(e) => setDefs(defs.map((x, j) => (j === i ? { ...x, multiline: e.target.checked } : x)))} />
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">Tag di berkas DOCX tidak dapat diubah di sini — unggah versi baru untuk menambah atau menghapus tag. Tag <code>{'{nomor}'}</code> dan <code>{'{nama_instansi}'}</code> diisi otomatis.</p>
        </div>
      </div>
    </Dialog>
  );
}

export function TemplatesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<OutgoingType>('UNDANGAN');
  const [name, setName] = useState('');
  const [approvedByName, setApproved] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [editing, setEditing] = useState<TemplateInfo | null>(null);
  const q = useQuery({ queryKey: ['templates', 'all'], queryFn: () => api.get<{ items: TemplateInfo[] }>('/templates') });
  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('type', type);
      fd.append('name', name);
      if (approvedByName) fd.append('approvedByName', approvedByName);
      fd.append('file', file!, file!.name);
      return api.post<TemplateInfo>('/templates', fd);
    },
    onSuccess: (t) => {
      toast.success(`Templat versi ${t.version} diunggah dengan ${t.placeholders.length} placeholder`);
      setFile(null);
      setName('');
      qc.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: (e) => toast.error(e),
  });
  const grouped = OUTGOING_TYPES.map((t) => ({ type: t, items: (q.data?.items ?? []).filter((x) => x.type === t) }));
  return (
    <div>
      <PageHeader title="Templat Surat Keluar" description="Kelola templat DOCX resmi beserta versinya. Gunakan tag {nama_field} di dalam dokumen Word." breadcrumbs={[{ label: 'Administrasi' }, { label: 'Templat' }]} />
      <Card title="Unggah templat / versi baru" className="mb-4">
        <form className="grid gap-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); upload.mutate(); }}>
          <Field label="Jenis"><Select value={type} onChange={(e) => setType(e.target.value as OutgoingType)}>{OUTGOING_TYPES.map((t) => <option key={t} value={t}>{OUTGOING_TYPE_LABELS[t]}</option>)}</Select></Field>
          <Field label="Nama templat"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Surat Undangan Resmi 2026" /></Field>
          <Field label="Disetujui oleh"><Input value={approvedByName} onChange={(e) => setApproved(e.target.value)} /></Field>
          <Field label="Berkas DOCX">
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Pilih</Button>
              <span className="truncate text-xs text-slate-600">{file?.name ?? 'Belum dipilih'}</span>
              <input ref={fileRef} type="file" accept=".docx" className="sr-only" aria-label="Pilih berkas DOCX" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
          </Field>
          <div className="sm:col-span-4"><Button type="submit" disabled={!file || name.length < 3} loading={upload.isPending}>Unggah</Button></div>
        </form>
      </Card>
      {q.isLoading ? <Spinner /> : q.isError ? <ErrorState error={q.error} /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {grouped.map((g) => (
            <Card key={g.type} title={OUTGOING_TYPE_LABELS[g.type]} bodyClassName="p-0">
              {g.items.length === 0 ? <EmptyState title="Belum ada templat" /> : (
                <ul className="divide-y divide-slate-100">
                  {g.items.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                      <div>
                        <p className="text-sm font-medium">{t.name} <Badge tone="blue">v{t.version}</Badge> {t.isActive ? <Badge tone="green">Aktif</Badge> : <Badge>Nonaktif</Badge>} {t.isSample && <Badge tone="yellow">Contoh</Badge>}</p>
                        <p className="text-xs text-slate-500">{t.placeholders.length} placeholder · {t._count?.outgoingLetters ?? 0} surat · {t.approvedByName ? `disetujui ${t.approvedByName}` : 'belum ada penyetuju'}{t.activeFrom ? ` · berlaku ${formatDate(t.activeFrom)}` : ''}</p>
                      </div>
                      <div className="flex gap-1">
                        {t.file && <a href={documentUrl(t.file.id, true)}><Button size="sm" variant="ghost" aria-label="Unduh templat"><Download className="h-4 w-4" /></Button></a>}
                        <Button size="sm" variant="ghost" onClick={() => setEditing(t)} aria-label="Ubah templat"><Pencil className="h-4 w-4" /></Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}
      {(q.data?.items ?? []).some((t) => t.isSample && t.isActive) && <div className="mt-4"><Alert tone="warning">Templat bertanda “Contoh” hanya untuk pengembangan. Unggah templat resmi organisasi dan nonaktifkan templat contoh sebelum digunakan.</Alert></div>}
      {editing && <EditTemplateDialog t={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
