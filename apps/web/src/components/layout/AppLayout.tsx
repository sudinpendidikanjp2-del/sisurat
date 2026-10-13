import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  BarChart3,
  Bell,
  ClipboardList,
  FileOutput,
  FileText,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  Settings,
  Stamp,
  Users,
  X,
  FileCog,
  KeyRound,
} from 'lucide-react';
import type { Permission } from '@sisurat/shared';
import { ROLE_LABELS, type RoleCode } from '@sisurat/shared';
import { useAuth } from '../../features/auth/AuthContext';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { NotificationInfo } from '../../types/api';
import { cn } from '../../lib/cn';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Inbox;
  perms?: Permission[];
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Utama',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, perms: ['dashboard.read'] },
      { to: '/surat-masuk', label: 'Surat Masuk', icon: Inbox },
      { to: '/disposisi', label: 'Disposisi', icon: Stamp, perms: ['disposition.create', 'disposition.review'] },
      { to: '/tugas', label: 'Tugas Saya', icon: ClipboardList, perms: ['assignment.work'] },
      { to: '/surat-keluar', label: 'Surat Keluar', icon: FileOutput, perms: ['outgoing.create', 'outgoing.read_all', 'outgoing.review'] },
      { to: '/arsip', label: 'Arsip', icon: Archive, perms: ['letter.read_all', 'letter.archive'] },
      { to: '/laporan', label: 'Laporan', icon: BarChart3, perms: ['report.read'] },
    ],
  },
  {
    section: 'Administrasi',
    items: [
      { to: '/admin/pengguna', label: 'Pengguna & Peran', icon: Users, perms: ['user.manage', 'role.manage'] },
      { to: '/admin/templat', label: 'Templat Surat', icon: FileCog, perms: ['template.manage'] },
      { to: '/admin/konfigurasi', label: 'Konfigurasi & AI', icon: Settings, perms: ['config.manage'] },
      { to: '/admin/audit', label: 'Audit Log', icon: ScrollText, perms: ['audit.read'] },
    ],
  },
];

function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ['notifications', 'bell'],
    queryFn: () => api.get<{ items: NotificationInfo[]; unread: number }>('/notifications', { pageSize: 8 }),
    refetchInterval: 60_000,
  });
  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = data?.unread ?? 0;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Notifikasi${unread ? `, ${unread} belum dibaca` : ''}`}
        className="relative rounded-full p-2 text-slate-600 hover:bg-slate-100"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">Notifikasi</span>
            {unread > 0 && (
              <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => markAll.mutate()}>
                Tandai semua dibaca
              </button>
            )}
          </div>
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {(data?.items ?? []).length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">Belum ada notifikasi</li>}
            {data?.items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={cn('block w-full px-3 py-2 text-left hover:bg-slate-50', !n.readAt && 'bg-brand-50/50')}
                  onClick={() => {
                    if (!n.readAt) markRead.mutate(n.id);
                    setOpen(false);
                    if (n.link) navigate(n.link);
                  }}
                >
                  <p className="text-sm font-medium text-slate-800">{n.title}</p>
                  <p className="line-clamp-2 text-xs text-slate-600">{n.message}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">{formatDateTime(n.createdAt)}</p>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="block w-full border-t px-3 py-2 text-center text-xs text-brand-700 hover:bg-slate-50" onClick={() => { setOpen(false); navigate('/notifikasi'); }}>
            Lihat semua
          </button>
        </div>
      )}
    </div>
  );
}

export function AppLayout() {
  const { user, can, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => setMobileOpen(false), [location.pathname]);

  const sidebar = (
    <nav aria-label="Navigasi utama" className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-4">
        <FileText className="h-7 w-7 text-white" aria-hidden />
        <div>
          <p className="text-base leading-tight font-bold text-white">SiSurat</p>
          <p className="text-[11px] text-brand-200">Manajemen Surat & Disposisi</p>
        </div>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-2 py-2">
        {NAV.map((group) => {
          const items = group.items.filter((i) => !i.perms || can(...i.perms));
          if (!items.length) return null;
          return (
            <div key={group.section}>
              <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-brand-300 uppercase">{group.section}</p>
              <ul className="space-y-0.5">
                {items.map((i) => (
                  <li key={i.to}>
                    <NavLink
                      to={i.to}
                      end={i.to === '/'}
                      className={({ isActive }) =>
                        cn('flex items-center gap-2.5 rounded-md px-3 py-2 text-sm', isActive ? 'bg-white/15 font-medium text-white' : 'text-brand-100 hover:bg-white/10 hover:text-white')
                      }
                    >
                      <i.icon className="h-4 w-4" aria-hidden />
                      {i.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <a href="#konten" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Lewati ke konten
      </a>
      <aside className="hidden w-60 shrink-0 bg-brand-900 lg:block">{sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="relative h-full w-64 bg-brand-900">
            <button type="button" className="absolute top-3 right-3 text-white" onClick={() => setMobileOpen(false)} aria-label="Tutup menu">
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <button type="button" className="rounded p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Buka menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <NotificationBell />
          <div className="hidden text-right sm:block">
            <p className="text-sm leading-tight font-medium text-slate-800">{user?.fullName}</p>
            <p className="text-xs text-slate-500">{user?.roles.map((r) => ROLE_LABELS[r as RoleCode] ?? r).join(', ')}</p>
          </div>
          <button type="button" onClick={() => navigate('/ganti-password')} className="rounded-full p-2 text-slate-600 hover:bg-slate-100" aria-label="Ganti kata sandi" title="Ganti kata sandi">
            <KeyRound className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
            className="rounded-full p-2 text-slate-600 hover:bg-slate-100"
            aria-label="Keluar"
            title="Keluar"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </header>
        <main id="konten" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
