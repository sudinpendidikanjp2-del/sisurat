import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import type { Permission } from '@sisurat/shared';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from './AuthContext';
import { Spinner } from '../../components/ui';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Memeriksa sesi…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (user.mustChangePassword && location.pathname !== '/ganti-password') return <Navigate to="/ganti-password" replace />;
  return <>{children}</>;
}

/** UI-level guard only — every action is authorised again on the server. */
export function RequirePermission({ perms, children }: { perms: Permission[]; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(...perms)) return <Forbidden />;
  return <>{children}</>;
}

export function Forbidden() {
  return (
    <div className="flex flex-col items-center gap-2 py-20 text-center">
      <ShieldAlert className="h-12 w-12 text-slate-300" aria-hidden />
      <h1 className="text-lg font-semibold text-slate-800">Akses ditolak</h1>
      <p className="text-sm text-slate-500">Anda tidak memiliki hak akses untuk membuka halaman ini.</p>
    </div>
  );
}
