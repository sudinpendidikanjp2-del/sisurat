import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { FileText } from 'lucide-react';
import { loginSchema, type LoginInput } from '@sisurat/shared';
import { useAuth } from './AuthContext';
import { Alert, Button, Field, Input } from '../../components/ui';
import { ApiError } from '../../lib/api';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  if (user) return <Navigate to="/" replace />;

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      const me = await login(v.username, v.password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(me.mustChangePassword ? '/ganti-password' : from || '/', { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal masuk');
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 to-brand-700 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl sm:p-8">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="rounded-lg bg-brand-700 p-2.5">
            <FileText className="h-7 w-7 text-white" aria-hidden />
          </div>
          <h1 className="text-xl font-bold text-slate-900">SiSurat</h1>
          <p className="text-sm text-slate-500">Sistem Manajemen Surat, Disposisi & Tindak Lanjut</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Nama pengguna" error={formState.errors.username?.message} required>
            <Input autoComplete="username" autoFocus {...register('username')} />
          </Field>
          <Field label="Kata sandi" error={formState.errors.password?.message} required>
            <Input type="password" autoComplete="current-password" {...register('password')} />
          </Field>
          <Button type="submit" className="w-full" loading={formState.isSubmitting}>
            Masuk
          </Button>
          <p className="text-center text-xs text-slate-500">Lupa kata sandi? Hubungi administrator untuk tautan reset.</p>
        </form>
      </div>
    </div>
  );
}
