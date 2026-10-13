import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { changePasswordSchema, passwordPolicy } from '@sisurat/shared';
import { useAuth } from './AuthContext';
import { Alert, Button, Card, Field, Input, PageHeader, useToast } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

const changeForm = changePasswordSchema.extend({ confirm: z.string() }).refine((v) => v.newPassword === v.confirm, {
  message: 'Konfirmasi kata sandi tidak sama',
  path: ['confirm'],
});

export function ChangePasswordPage() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState, reset } = useForm<z.infer<typeof changeForm>>({ resolver: zodResolver(changeForm) });
  const onSubmit = handleSubmit(async ({ confirm: _c, ...v }) => {
    setError(null);
    try {
      await api.post('/auth/change-password', v);
      toast.success('Kata sandi berhasil diubah');
      reset();
      await refresh();
      navigate('/');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal mengubah kata sandi');
    }
  });
  return (
    <div className="max-w-lg">
      <PageHeader title="Ganti kata sandi" breadcrumbs={[{ label: 'Beranda', to: '/' }, { label: 'Ganti kata sandi' }]} />
      {user?.mustChangePassword && (
        <div className="mb-4">
          <Alert tone="warning" title="Wajib mengganti kata sandi">
            Akun Anda menggunakan kata sandi awal. Ganti sebelum melanjutkan.
          </Alert>
        </div>
      )}
      <Card>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Kata sandi lama" required error={formState.errors.currentPassword?.message}>
            <Input type="password" autoComplete="current-password" {...register('currentPassword')} />
          </Field>
          <Field label="Kata sandi baru" required error={formState.errors.newPassword?.message} hint="Minimal 10 karakter, mengandung huruf besar, huruf kecil, dan angka.">
            <Input type="password" autoComplete="new-password" {...register('newPassword')} />
          </Field>
          <Field label="Ulangi kata sandi baru" required error={formState.errors.confirm?.message}>
            <Input type="password" autoComplete="new-password" {...register('confirm')} />
          </Field>
          <Button type="submit" loading={formState.isSubmitting}>
            Simpan
          </Button>
        </form>
      </Card>
    </div>
  );
}

const resetForm = z.object({ newPassword: passwordPolicy, confirm: z.string() }).refine((v) => v.newPassword === v.confirm, {
  message: 'Konfirmasi kata sandi tidak sama',
  path: ['confirm'],
});

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof resetForm>>({ resolver: zodResolver(resetForm) });
  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, newPassword: v.newPassword });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal mengatur ulang kata sandi');
    }
  });
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow">
        <h1 className="mb-4 text-lg font-semibold">Atur ulang kata sandi</h1>
        {done ? (
          <Alert tone="success" title="Kata sandi diperbarui">
            Silakan <Link to="/login" className="underline">masuk</Link> dengan kata sandi baru.
          </Alert>
        ) : !token ? (
          <Alert tone="error">Tautan tidak valid.</Alert>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {error && <Alert tone="error">{error}</Alert>}
            <Field label="Kata sandi baru" required error={formState.errors.newPassword?.message}>
              <Input type="password" autoComplete="new-password" {...register('newPassword')} />
            </Field>
            <Field label="Ulangi kata sandi baru" required error={formState.errors.confirm?.message}>
              <Input type="password" autoComplete="new-password" {...register('confirm')} />
            </Field>
            <Button type="submit" className="w-full" loading={formState.isSubmitting}>
              Simpan kata sandi
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
