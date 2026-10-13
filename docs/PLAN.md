# Tahap 0 — Audit dan Rencana Implementasi

Dokumen acuan: *PRD Sistem Manajemen Surat, Disposisi, Tindak Lanjut, OCR dan Ekstraksi Metadata Berbasis AI — v1.1 (13 Oktober 2026)*.

## 1. Hasil audit repository

| Aspek | Temuan |
|---|---|
| Isi repository | Kosong (belum ada commit, belum ada kode, schema, atau dependency). |
| Stack aktual | Tidak ada → memakai baseline dari master prompt. |
| Konflik dengan PRD | Tidak ada kode lama yang harus dipertahankan; tidak ada konflik teknologi. |
| Lingkungan pengembangan | Node.js 22, npm 10, PostgreSQL 16 tersedia; `pdftoppm` tersedia, `tesseract` tidak terpasang. |

Karena repository kosong, seluruh aplikasi dibangun dari awal sebagai **modular monolith** dalam satu monorepo npm workspaces.

## 2. Keputusan stack

| Lapisan | Pilihan | Alasan |
|---|---|---|
| Monorepo | npm workspaces (`apps/api`, `apps/web`, `packages/shared`) | Tanpa tool tambahan; skema Zod & enum dipakai bersama. |
| Backend | Fastify 5 + TypeScript | Ringan, plugin resmi untuk cookie, multipart, rate limit, helmet. |
| ORM/DB | Prisma 7 + PostgreSQL (driver adapter `@prisma/adapter-pg`) | Sesuai PRD; migration terversi. |
| Validasi | Zod 4 (server & client) | Satu sumber skema di `packages/shared`. |
| Auth | Sesi server-side (tabel `Session`) + cookie httpOnly, token CSRF per sesi, hash password `scrypt` (bawaan Node) | Tidak ada token di localStorage; revokasi sesi mudah; tanpa dependency native. |
| Queue | Antrean berbasis tabel `ExtractionJob` dengan `FOR UPDATE SKIP LOCKED` | Volume < 20 surat/hari; tidak perlu Redis; status job dapat dipantau dan idempoten. |
| PDF lokal | `unpdf` (pdf.js) | Ekstraksi teks & jumlah halaman tanpa layanan eksternal. |
| OCR lokal | CLI `tesseract` + `pdftoppm` (opsional) | Fallback tanpa mengirim data ke luar; dinonaktifkan bila biner tidak ada. |
| AI | Gemini (`@google/genai`) sebagai provider utama, Claude (`@anthropic-ai/sdk`) alternatif | Sesuai PRD, di belakang antarmuka `DocumentAIProvider`. |
| DOCX | `docxtemplater` + `pizzip` | Mengisi placeholder tanpa merusak tata letak templat. |
| Frontend | Vite + React + TS, React Router, TanStack Query, React Hook Form + Zod, Tailwind CSS 4 | Sesuai baseline. |
| Test | Vitest (unit + integrasi dengan PostgreSQL nyata), Testing Library untuk web | Provider AI di-mock; tidak butuh API key. |

**PWA/service worker sengaja tidak diaktifkan**: dokumen surat bersifat privat, dan cache offline di perangkat pengguna menambah risiko kebocoran. Dapat ditambahkan kemudian khusus untuk aset statis.

## 3. Arsitektur

```
apps/web  ──HTTP (cookie sesi + X-CSRF-Token)──►  apps/api (Fastify)
                                                   ├─ modules/*  (route → service → Prisma)
                                                   ├─ lib/authz  (RBAC + akses per objek)
                                                   ├─ storage/   (penyimpanan privat, storage key)
                                                   ├─ ai/        (DocumentAIService + provider)
                                                   └─ jobs/      (worker ekstraksi & pengingat tenggat)
                                                          │
                                                   PostgreSQL ◄──┘     Disk privat (DOCUMENT_STORAGE_PATH)
```

* Status bisnis surat (`LetterStatus`) **terpisah** dari status pemrosesan (`ProcessingStatus`).
* Hasil AI disimpan di `ExtractionResult` (mentah + normalisasi); metadata final ada di `IncomingLetter` dan hanya diisi saat verifikasi.
* Koreksi petugas dicatat per field di `MetadataCorrection` (nilai AI vs nilai final).
* Dokumen asli tidak pernah ditimpa; berkas disimpan dengan nama acak + checksum SHA-256.

## 4. Schema database awal

Lihat `prisma/schema.prisma`. Entitas: `User`, `Role`, `Permission`, `RolePermission`, `UserRole`, `Session`, `PasswordResetToken`, `Unit`, `IncomingLetter`, `Document`, `ExtractionJob`, `ExtractionResult`, `MetadataCorrection`, `Disposition`, `Assignment`, `WorkUpdate`, `OutgoingLetter`, `OutgoingLetterLink`, `DocumentTemplate`, `Notification`, `AuditLog`, `AiProviderConfig`, `AppSetting`, `NumberSequence`, `IdempotencyRecord`.

## 5. Asumsi (default aman — perlu dikonfirmasi pemilik proses)

1. **Pengiriman ke AI eksternal dimatikan secara default.** Admin harus menyetujui provider dan menentukan tingkat kerahasiaan yang boleh dikirim. Surat `RAHASIA` tidak pernah dikirim kecuali dikonfigurasi eksplisit.
2. **Tidak ada fallback lintas provider otomatis.** Claude hanya dipakai bila dipilih sebagai provider aktif atau dijalankan manual oleh petugas berwenang.
3. **Format nomor agenda default** `{seq:4}/AG/{roman_month}/{yyyy}` dengan urutan reset per tahun; dapat diubah admin.
4. **Format nomor surat keluar default** `{seq:3}/{code}/{roman_month}/{yyyy}` — diberikan saat finalisasi, bukan saat draft.
5. **Batas unggah default** 15 MB per berkas, 30 halaman per PDF, 10 berkas per surat.
6. **Verifikator metadata** = peran Petugas TU. **Penyetuju tindak lanjut** = pemberi disposisi (atau pengguna lain dengan izin `disposition.review`). **Penyetuju surat keluar** = Pimpinan (`outgoing.review`).
7. **Administrator tidak otomatis dapat membaca isi surat** (prinsip least privilege PRD §5).
8. Templat DOCX resmi belum tersedia → seed membuat **templat contoh** yang jelas bertanda "CONTOH".
9. Tulisan tangan tidak didukung secara khusus pada MVP.
10. Pemindaian malware: belum ada mesin antivirus; validasi magic bytes, ekstensi, ukuran, dan jumlah halaman diterapkan. Integrasi ClamAV dicatat sebagai pekerjaan lanjutan.

## 6. Keputusan yang membutuhkan persetujuan pemilik proses

* Kebijakan pengiriman surat dinas ke Gemini/Claude (kategori, tier layanan berbayar vs gratis, lokasi pemrosesan, retensi).
* Aturan penomoran agenda dan surat keluar resmi.
* Kebijakan retensi arsip dan hasil ekstraksi mentah.
* Pejabat yang berwenang memverifikasi metadata dan mengesahkan surat keluar.
* Penggunaan tanda tangan elektronik (di luar MVP).

## 7. Risiko

| Risiko | Mitigasi dalam implementasi |
|---|---|
| AI salah baca | Hasil selalu draft, verifikasi wajib, flag per field, audit koreksi. |
| Kebocoran dokumen | Storage privat, akses per objek, audit unduhan, kebijakan provider per tingkat kerahasiaan. |
| Prompt injection | Isi dokumen dibungkus sebagai data, system prompt tetap, keluaran divalidasi skema; AI tidak memicu aksi. |
| Retry membuat duplikat | Advisory lock + satu job aktif per dokumen, `ExtractionResult.jobId` unik, `Idempotency-Key` pada pembuatan surat. |
| Provider tidak tersedia | Retry terbatas dengan backoff, status `PROCESSING_FAILED`, jalur manual. |
| Nama model/SDK berubah | Model dikonfigurasi via env/admin; provider terisolasi di adapter. |

## 8. Checklist implementasi terukur

### Tahap 1 — Fondasi
- [x] Monorepo, TypeScript, lint, test runner
- [x] Prisma schema + migration awal + seed pengembangan
- [x] Login/logout, sesi, CSRF, rate limit, lockout, reset password via token admin
- [x] RBAC berbasis tabel + akses per objek
- [x] Register surat manual + unggah berkas privat + audit log
- [x] Layout aplikasi (sidebar, header, breadcrumb, notifikasi)

### Tahap 2 — OCR/AI
- [x] Ekstraksi teks PDF lokal + parser heuristik
- [x] Adapter Gemini, Claude, Tesseract; router kebijakan
- [x] Worker job dengan retry/backoff/timeout, idempoten
- [x] Halaman verifikasi berdampingan + pencatatan koreksi
- [x] Pencatatan pemakaian token/halaman/biaya estimasi

### Tahap 3 — Disposisi
- [x] Disposisi dengan beberapa pelaksana, tenggat, prioritas
- [x] Progres, bukti, ajukan pemeriksaan, setujui/minta revisi, batal dengan alasan, alih tugas
- [x] Notifikasi dalam aplikasi + pengingat tenggat/terlambat

### Tahap 4 — Surat keluar & arsip
- [x] Templat DOCX berversi (5 jenis), deteksi placeholder
- [x] Draft → pemeriksaan → disetujui → final, relasi ke surat masuk/disposisi
- [x] Arsip, pencarian, filter, laporan + ekspor CSV, dashboard dari database

### Tahap 5 — Hardening
- [x] Test otomatis (auth, otorisasi, upload, ekstraksi, retry, disposisi, DOCX, audit, pagination)
- [x] Dokumentasi instalasi, API, arsitektur, provider AI, templat, backup, deployment, troubleshooting
- [ ] Pilot dengan dokumen kantor nyata (butuh persetujuan organisasi)
- [ ] Integrasi antivirus, email, konversi PDF (pekerjaan lanjutan)
