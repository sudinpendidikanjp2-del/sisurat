import { createBrowserRouter, Link } from 'react-router';
import { AppLayout } from '../components/layout/AppLayout';
import { RequireAuth, RequirePermission } from '../features/auth/guards';
import { LoginPage } from '../features/auth/LoginPage';
import { ChangePasswordPage, ResetPasswordPage } from '../features/auth/PasswordPages';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { LetterListPage } from '../features/incoming-letters/LetterListPage';
import { LetterUploadPage } from '../features/incoming-letters/LetterUploadPage';
import { LetterDetailPage } from '../features/incoming-letters/LetterDetailPage';
import { VerifyPage } from '../features/incoming-letters/VerifyPage';
import { DispositionCreatePage, DispositionInboxPage } from '../features/dispositions/DispositionPages';
import { AssignmentDetailPage, MyTasksPage } from '../features/assignments/AssignmentPages';
import { OutgoingListPage } from '../features/outgoing-letters/OutgoingListPage';
import { OutgoingFormPage } from '../features/outgoing-letters/OutgoingFormPage';
import { OutgoingDetailPage } from '../features/outgoing-letters/OutgoingDetailPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { UsersPage } from '../features/settings/UsersPage';
import { TemplatesPage } from '../features/settings/TemplatesPage';
import { ConfigPage } from '../features/settings/ConfigPage';
import { AuditLogPage } from '../features/settings/AuditLogPage';
import { NotificationsPage } from '../features/notifications/NotificationsPage';
import { useAuth } from '../features/auth/AuthContext';

function Home() {
  const { can } = useAuth();
  return can('dashboard.read') ? <DashboardPage /> : <LetterListPage />;
}

function NotFound() {
  return (
    <div className="py-20 text-center">
      <h1 className="text-lg font-semibold">Halaman tidak ditemukan</h1>
      <Link to="/" className="text-sm text-brand-700 underline">Kembali ke beranda</Link>
    </div>
  );
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Home /> },
      { path: 'ganti-password', element: <ChangePasswordPage /> },
      { path: 'notifikasi', element: <NotificationsPage /> },
      { path: 'surat-masuk', element: <LetterListPage /> },
      { path: 'surat-masuk/baru', element: <RequirePermission perms={['letter.create']}><LetterUploadPage /></RequirePermission> },
      { path: 'surat-masuk/:id', element: <LetterDetailPage /> },
      { path: 'surat-masuk/:id/verifikasi', element: <RequirePermission perms={['letter.verify']}><VerifyPage /></RequirePermission> },
      { path: 'surat-masuk/:id/disposisi', element: <RequirePermission perms={['disposition.create']}><DispositionCreatePage /></RequirePermission> },
      { path: 'disposisi', element: <RequirePermission perms={['disposition.create', 'disposition.review']}><DispositionInboxPage /></RequirePermission> },
      { path: 'tugas', element: <RequirePermission perms={['assignment.work']}><MyTasksPage /></RequirePermission> },
      { path: 'tugas/:id', element: <AssignmentDetailPage /> },
      { path: 'surat-keluar', element: <OutgoingListPage /> },
      { path: 'surat-keluar/baru', element: <RequirePermission perms={['outgoing.create']}><OutgoingFormPage /></RequirePermission> },
      { path: 'surat-keluar/:id', element: <OutgoingDetailPage /> },
      { path: 'surat-keluar/:id/ubah', element: <RequirePermission perms={['outgoing.create']}><OutgoingFormPage /></RequirePermission> },
      { path: 'arsip', element: <LetterListPage archived /> },
      { path: 'laporan', element: <RequirePermission perms={['report.read']}><ReportsPage /></RequirePermission> },
      { path: 'admin/pengguna', element: <RequirePermission perms={['user.manage', 'role.manage']}><UsersPage /></RequirePermission> },
      { path: 'admin/templat', element: <RequirePermission perms={['template.manage']}><TemplatesPage /></RequirePermission> },
      { path: 'admin/konfigurasi', element: <RequirePermission perms={['config.manage']}><ConfigPage /></RequirePermission> },
      { path: 'admin/audit', element: <RequirePermission perms={['audit.read']}><AuditLogPage /></RequirePermission> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
