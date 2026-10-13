import type { RoleCode } from './enums';

/**
 * Permission catalogue. Roles are stored in the database and editable by an administrator;
 * DEFAULT_ROLE_PERMISSIONS is only the seed / reset baseline.
 */
export const PERMISSIONS = {
  'user.manage': 'Mengelola pengguna',
  'role.manage': 'Mengelola peran dan hak akses',
  'config.manage': 'Mengelola konfigurasi aplikasi dan provider AI',
  'template.manage': 'Mengelola templat surat',
  'audit.read': 'Membaca audit log',
  'dashboard.read': 'Melihat dashboard',
  'letter.create': 'Mengunggah dan mencatat surat masuk',
  'letter.read_all': 'Membaca seluruh register surat (non-rahasia)',
  'letter.read_confidential': 'Membaca surat berklasifikasi rahasia',
  'letter.update': 'Mengoreksi metadata surat',
  'letter.verify': 'Memverifikasi metadata dan mendaftarkan surat',
  'letter.forward': 'Meneruskan surat untuk disposisi',
  'letter.archive': 'Mengarsipkan surat',
  'letter.delete': 'Menghapus (sementara) surat',
  'extraction.run': 'Menjalankan / mengulang ekstraksi OCR-AI',
  'disposition.create': 'Memberikan disposisi',
  'disposition.review': 'Memeriksa dan menyetujui hasil tindak lanjut',
  'assignment.work': 'Mengerjakan penugasan sendiri',
  'outgoing.create': 'Menyusun surat keluar',
  'outgoing.review': 'Memeriksa dan menyetujui surat keluar',
  'outgoing.finalize': 'Memberi nomor dan memfinalkan surat keluar',
  'outgoing.read_all': 'Membaca seluruh surat keluar',
  'report.read': 'Melihat laporan',
  'report.export': 'Mengekspor laporan',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_CODES = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_LABELS: Record<RoleCode, string> = {
  ADMIN: 'Administrator',
  REGISTRAR: 'Petugas TU / Registrator',
  LEADER: 'Pimpinan / Pejabat Disposisi',
  STAFF: 'Pegawai Pelaksana',
  AUDITOR: 'Pemeriksa / Auditor',
};

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  // Least privilege: admin manages the system but does not read letter contents by default (PRD §5).
  ADMIN: ['user.manage', 'role.manage', 'config.manage', 'template.manage', 'audit.read', 'dashboard.read'],
  REGISTRAR: [
    'dashboard.read',
    'letter.create',
    'letter.read_all',
    'letter.update',
    'letter.verify',
    'letter.forward',
    'letter.archive',
    'letter.delete',
    'extraction.run',
    'outgoing.create',
    'outgoing.finalize',
    'outgoing.read_all',
    'report.read',
    'report.export',
  ],
  LEADER: [
    'dashboard.read',
    'letter.read_all',
    'letter.read_confidential',
    'disposition.create',
    'disposition.review',
    'outgoing.create',
    'outgoing.review',
    'outgoing.read_all',
    'report.read',
    'report.export',
  ],
  STAFF: ['dashboard.read', 'assignment.work', 'outgoing.create'],
  AUDITOR: ['dashboard.read', 'letter.read_all', 'outgoing.read_all', 'audit.read', 'report.read'],
};
