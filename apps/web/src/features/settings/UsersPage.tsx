import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { KeyRound, Plus, Unlock, UserPen } from 'lucide-react';
import { ROLE_CODES, ROLE_LABELS, userCreateSchema, type RoleCode } from '@sisurat/shared';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { Paged } from '../../types/api';
import { Alert, Badge, Button, Card, Checkbox, DataTable, Dialog, EmptyState, ErrorState, Field, Input, PageHeader, Pagination, Select, Spinner, Tabs, useToast, type Column } from '../../components/ui';
import { useAuth } from '../auth/AuthContext';

interface UserRow {
  id: string;
  username: string;
  email: string | null;
  fullName: string;
  position: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  unit: { id: string; name: string } | null;
  roles: RoleCode[];
}
interface Unit { id: string; code: string; name: string }
interface RoleRow { id: string; code: RoleCode; name: string; userCount: number; permissions: string[] }

const editSchema = z.object({
  fullName: z.string().trim().min(2),
  email: z.string().trim().email('Email tidak valid').or(z.literal('')),
  position: z.string().trim().max(150),
  unitId: z.string(),
  roles: z.array(z.enum(ROLE_CODES)).min(1, 'Pilih minimal satu peran'),
  isActive: z.boolean(),
});
type EditValues = z.infer<typeof editSchema>;
type CreateValues = z.input<typeof userCreateSchema>;

function RoleChecks({ value, onChange }: { value: RoleCode[]; onChange: (v: RoleCode[]) => void }) {
  return (
    <div className="grid gap-1 sm:grid-cols-2">
      {ROLE_CODES.map((r) => (
        <Checkbox key={r} label={ROLE_LABELS[r]} checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />
      ))}
    </div>
  );
}

function UserDialog({ user, units, open, onClose }: { user: UserRow | null; units: Unit[]; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const isNew = !user;
  const createForm = useForm<CreateValues>({ resolver: zodResolver(userCreateSchema), defaultValues: { username: '', fullName: '', email: '', position: '', unitId: '', roles: [], password: '' } });
  const editForm = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    values: user ? { fullName: user.fullName, email: user.email ?? '', position: user.position ?? '', unitId: user.unit?.id ?? '', roles: user.roles, isActive: user.isActive } : undefined,
  });
  const m = useMutation({
    mutationFn: (v: CreateValues | EditValues) => (isNew ? api.post('/users', v) : api.patch(`/users/${user!.id}`, v)),
    onSuccess: () => {
      toast.success(isNew ? 'Pengguna dibuat. Pengguna wajib mengganti kata sandi saat login pertama.' : 'Pengguna diperbarui');
      qc.invalidateQueries({ queryKey: ['users'] });
      createForm.reset();
      onClose();
    },
    onError: (e) => toast.error(e),
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isNew ? 'Tambah pengguna' : `Ubah ${user!.fullName}`}
      wide
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={m.isPending} onClick={isNew ? createForm.handleSubmit((v) => m.mutate(v)) : editForm.handleSubmit((v) => m.mutate(v))}>Simpan</Button></>}
    >
      {isNew ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nama pengguna" required error={createForm.formState.errors.username?.message}><Input autoComplete="off" {...createForm.register('username')} /></Field>
          <Field label="Nama lengkap" required error={createForm.formState.errors.fullName?.message}><Input {...createForm.register('fullName')} /></Field>
          <Field label="Email" error={createForm.formState.errors.email?.message as string | undefined}><Input type="email" {...createForm.register('email')} /></Field>
          <Field label="Jabatan"><Input {...createForm.register('position')} /></Field>
          <Field label="Unit"><Select {...createForm.register('unitId')}><option value="">—</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
          <Field label="Kata sandi awal" required error={createForm.formState.errors.password?.message} hint="Min. 10 karakter, huruf besar, huruf kecil, angka. Sampaikan secara aman."><Input type="password" autoComplete="new-password" {...createForm.register('password')} /></Field>
          <div className="sm:col-span-2">
            <p className="mb-1 text-sm font-medium text-slate-700">Peran <span className="text-red-600">*</span></p>
            {createForm.formState.errors.roles && <p className="text-xs text-red-600" role="alert">{createForm.formState.errors.roles.message}</p>}
            <Controller control={createForm.control} name="roles" render={({ field }) => <RoleChecks value={field.value as RoleCode[]} onChange={field.onChange} />} />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nama lengkap" required error={editForm.formState.errors.fullName?.message}><Input {...editForm.register('fullName')} /></Field>
          <Field label="Email" error={editForm.formState.errors.email?.message}><Input type="email" {...editForm.register('email')} /></Field>
          <Field label="Jabatan"><Input {...editForm.register('position')} /></Field>
          <Field label="Unit"><Select {...editForm.register('unitId')}><option value="">—</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
          <div className="sm:col-span-2">
            <p className="mb-1 text-sm font-medium text-slate-700">Peran</p>
            {editForm.formState.errors.roles && <p className="text-xs text-red-600" role="alert">{editForm.formState.errors.roles.message}</p>}
            <Controller control={editForm.control} name="roles" render={({ field }) => <RoleChecks value={field.value} onChange={field.onChange} />} />
          </div>
          <Controller control={editForm.control} name="isActive" render={({ field }) => <Checkbox label="Akun aktif" checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />} />
        </div>
      )}
    </Dialog>
  );
}

function UsersTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<UserRow | null | 'new'>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const units = useQuery({ queryKey: ['units'], queryFn: () => api.get<{ items: Unit[] }>('/units') });
  const q = useQuery({ queryKey: ['users', page, search], queryFn: () => api.get<Paged<UserRow>>('/users', { page, q: search }), placeholderData: keepPreviousData });
  const reset = useMutation({
    mutationFn: (id: string) => api.post<{ resetPath: string }>(`/users/${id}/reset-token`),
    onSuccess: (r) => setResetLink(`${window.location.origin}${r.resetPath}`),
    onError: (e) => toast.error(e),
  });
  const unlock = useMutation({ mutationFn: (id: string) => api.post(`/users/${id}/unlock`), onSuccess: () => { toast.success('Akun dibuka'); qc.invalidateQueries({ queryKey: ['users'] }); } });
  const columns: Column<UserRow>[] = [
    { header: 'Nama', cell: (u) => <div><p className="font-medium">{u.fullName}</p><p className="text-xs text-slate-500">{u.username}{u.position ? ` · ${u.position}` : ''}</p></div> },
    { header: 'Peran', cell: (u) => <div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r} tone="indigo">{ROLE_LABELS[r]}</Badge>)}</div> },
    { header: 'Unit', hideOnMobile: true, cell: (u) => <span className="text-xs">{u.unit?.name ?? '-'}</span> },
    { header: 'Status', cell: (u) => <div className="flex flex-col items-start gap-1">{u.isActive ? <Badge tone="green">Aktif</Badge> : <Badge>Nonaktif</Badge>}{u.lockedUntil && new Date(u.lockedUntil) > new Date() && <Badge tone="red">Terkunci</Badge>}</div> },
    { header: 'Login terakhir', hideOnMobile: true, cell: (u) => <span className="text-xs">{formatDateTime(u.lastLoginAt)}</span> },
    {
      header: 'Aksi',
      cell: (u) => (
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing(u)} aria-label={`Ubah ${u.fullName}`}><UserPen className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" onClick={() => reset.mutate(u.id)} aria-label={`Buat tautan reset untuk ${u.fullName}`} title="Tautan reset kata sandi"><KeyRound className="h-4 w-4" /></Button>
          {u.lockedUntil && new Date(u.lockedUntil) > new Date() && <Button size="sm" variant="ghost" onClick={() => unlock.mutate(u.id)} aria-label="Buka kunci"><Unlock className="h-4 w-4" /></Button>}
        </div>
      ),
    },
  ];
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <form onSubmit={(e) => { e.preventDefault(); setSearch(String(new FormData(e.currentTarget).get('q') ?? '')); setPage(1); }} className="flex gap-2">
          <Input name="q" placeholder="Cari nama / username" aria-label="Cari pengguna" />
          <Button type="submit" variant="secondary">Cari</Button>
        </form>
        <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Tambah pengguna</Button>
      </div>
      {resetLink && (
        <div className="mb-3">
          <Alert tone="warning" title="Tautan reset sekali pakai (berlaku 24 jam)">
            <code className="block break-all">{resetLink}</code>
            <p className="mt-1 text-xs">Sampaikan langsung kepada pengguna melalui kanal yang aman. Tautan tidak akan ditampilkan lagi.</p>
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => { navigator.clipboard?.writeText(resetLink); toast.success('Disalin'); }}>Salin</Button>
          </Alert>
        </div>
      )}
      <Card bodyClassName="p-0">
        {q.isLoading ? <Spinner /> : q.isError ? <div className="p-4"><ErrorState error={q.error} /></div> : q.data && q.data.items.length === 0 ? <EmptyState title="Tidak ada pengguna" /> : q.data ? (
          <><DataTable columns={columns} rows={q.data.items} /><Pagination meta={q.data.meta} onPage={setPage} /></>
        ) : null}
      </Card>
      <UserDialog user={editing === 'new' ? null : editing} units={units.data?.items ?? []} open={editing !== null} onClose={() => setEditing(null)} />
    </>
  );
}

function RolesTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['roles'], queryFn: () => api.get<{ items: RoleRow[]; catalog: { code: string; description: string }[] }>('/roles') });
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const save = useMutation({
    mutationFn: (role: RoleRow) => api.put(`/roles/${role.id}/permissions`, { permissions: draft[role.id] }),
    onSuccess: (_d, role) => { toast.success(`Izin ${role.name} disimpan`); setDraft(({ [role.id]: _x, ...rest }) => rest); qc.invalidateQueries({ queryKey: ['roles'] }); },
    onError: (e) => toast.error(e),
  });
  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <ErrorState error={q.error} />;
  const editable = can('role.manage');
  return (
    <Card bodyClassName="p-0">
      <Alert tone="info">Perubahan izin berlaku segera untuk semua pengguna dengan peran tersebut dan dicatat di audit log. Otorisasi selalu diperiksa di server.</Alert>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left">Izin</th>
              {q.data.items.map((r) => <th key={r.id} className="px-2 py-2 text-center">{r.name}<p className="font-normal text-slate-500">{r.userCount} pengguna</p></th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.data.catalog.map((p) => (
              <tr key={p.code}>
                <td className="px-3 py-1.5"><p className="font-medium">{p.description}</p><code className="text-[10px] text-slate-400">{p.code}</code></td>
                {q.data.items.map((r) => {
                  const current = draft[r.id] ?? r.permissions;
                  return (
                    <td key={r.id} className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300"
                        aria-label={`${p.description} untuk ${r.name}`}
                        disabled={!editable}
                        checked={current.includes(p.code)}
                        onChange={(e) => setDraft({ ...draft, [r.id]: e.target.checked ? [...current, p.code] : current.filter((x) => x !== p.code) })}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {editable && (
            <tfoot className="bg-slate-50">
              <tr>
                <td />
                {q.data.items.map((r) => <td key={r.id} className="px-2 py-2 text-center">{draft[r.id] && <Button size="sm" loading={save.isPending} onClick={() => save.mutate(r)}>Simpan</Button>}</td>)}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}

function UnitsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['units'], queryFn: () => api.get<{ items: Unit[] }>('/units') });
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const m = useMutation({ mutationFn: () => api.post('/units', { code, name }), onSuccess: () => { toast.success('Unit ditambahkan'); setCode(''); setName(''); qc.invalidateQueries({ queryKey: ['units'] }); }, onError: (e) => toast.error(e) });
  return (
    <Card>
      <form className="mb-4 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Kode"><Input value={code} onChange={(e) => setCode(e.target.value)} className="w-28" /></Field>
        <Field label="Nama unit"><Input value={name} onChange={(e) => setName(e.target.value)} className="w-72" /></Field>
        <Button type="submit" loading={m.isPending} disabled={!code || name.length < 2}>Tambah</Button>
      </form>
      <ul className="divide-y divide-slate-100 text-sm">{q.data?.items.map((u) => <li key={u.id} className="py-2"><Badge>{u.code}</Badge> <span className="ml-2">{u.name}</span></li>)}</ul>
    </Card>
  );
}

export function UsersPage() {
  const [tab, setTab] = useState<'users' | 'roles' | 'units'>('users');
  return (
    <div>
      <PageHeader title="Pengguna & Peran" description="Kelola akun, peran, hak akses, dan unit kerja." breadcrumbs={[{ label: 'Administrasi' }, { label: 'Pengguna & Peran' }]} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'users', label: 'Pengguna' }, { value: 'roles', label: 'Peran & izin' }, { value: 'units', label: 'Unit kerja' }]} />
      {tab === 'users' ? <UsersTab /> : tab === 'roles' ? <RolesTab /> : <UnitsTab />}
    </div>
  );
}
