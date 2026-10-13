# SiSurat — Sistem Manajemen Surat, Disposisi, OCR & AI

Aplikasi web untuk mengelola surat dinas: penerimaan dan registrasi surat masuk oleh Tata Usaha,
ekstraksi metadata (teks PDF lokal → AI/OCR sesuai kebijakan), verifikasi manusia, disposisi pimpinan,
tindak lanjut pegawai, pembuatan surat keluar dari templat DOCX, arsip, laporan, dan audit trail.

Dibangun berdasarkan *PRD v1.1 (13 Oktober 2026)*. Rencana, asumsi, dan risiko: [`docs/PLAN.md`](docs/PLAN.md).

## Fitur utama

- **Surat masuk**: unggah PDF/JPEG/PNG (validasi magic bytes, ukuran, halaman), penyimpanan privat,
  registrasi manual tanpa AI, nomor agenda yang dapat dikonfigurasi, deteksi duplikat, pencarian & filter.
- **OCR/AI**: PDF digital dibaca lokal tanpa AI; dokumen scan → Gemini (utama) / Claude (alternatif) /
  Tesseract lokal, **hanya** bila provider diaktifkan dan disetujui untuk klasifikasi surat tersebut.
  Hasil selalu draft; verifikasi berdampingan dengan dokumen asli; koreksi dicatat per field.
- **Disposisi & tindak lanjut**: arahan, beberapa pelaksana, prioritas, tenggat, progres + bukti,
  ajukan → setujui / minta revisi, alih tugas, pembatalan dengan alasan, notifikasi & pengingat tenggat.
- **Surat keluar**: lima jenis templat DOCX berversi, isian placeholder, draft → pemeriksaan → disetujui →
  final bernomor, relasi ke surat masuk/disposisi, setiap perubahan menghasilkan versi dokumen baru.
- **Dashboard & laporan** dari data nyata, ekspor CSV, **audit log**, manajemen pengguna/peran/izin.

## Stack

| Bagian | Teknologi |
|---|---|
| Frontend | Vite, React 19, TypeScript, React Router, TanStack Query, React Hook Form + Zod, Tailwind CSS 4 |
| Backend | Node.js 22, Fastify 5, TypeScript, Zod, Prisma 7 (PostgreSQL) |
| Dokumen | `unpdf` (teks PDF), `docxtemplater` (DOCX), Tesseract CLI (opsional) |
| AI | `@google/genai` (Gemini), `@anthropic-ai/sdk` (Claude) di balik `DocumentAIService` |
| Test | Vitest (API: PostgreSQL sungguhan + provider tiruan; web: jsdom), Playwright (E2E) |

## Struktur

```
apps/api      REST API, worker, Prisma client, seed
apps/web      Aplikasi React
packages/shared  Enum, izin, label, skema Zod yang dipakai API dan web
prisma/       schema.prisma + migrations
tests/e2e     Skenario Playwright
docs/         Dokumentasi
deploy/       Contoh konfigurasi nginx
```

## Menjalankan secara lokal

Prasyarat: Node.js ≥ 20.19 (disarankan 22), npm 10, PostgreSQL 16 (via Docker atau lokal).

```bash
npm install
docker compose up -d db        # PostgreSQL di localhost:5432 (user/pass/db: sisurat)
npm run setup                  # migrate deploy + seed
npm run dev                    # API :3000, worker, web :5173
```

Buka <http://localhost:5173>. **Tidak perlu mengisi `DATABASE_URL`** untuk pengembangan: nilai default
sama dengan database di `docker-compose.yml`. Tanpa Docker, buat role/database `sisurat` (password `sisurat`)
di PostgreSQL lokal, atau set `DATABASE_URL` di `apps/api/.env` (lihat [`.env.example`](.env.example)).

Seed menampilkan kata sandi **sekali** di terminal (atau gunakan `SEED_ADMIN_PASSWORD` / `SEED_DEMO_PASSWORD`).
Akun yang dibuat: `admin` (wajib ganti kata sandi saat login pertama) dan pengguna contoh
`tu`, `pimpinan`, `pegawai1`, `pegawai2`, `auditor` (hanya di non-production).

| Perintah | Fungsi |
|---|---|
| `npm run dev` | API + worker + web dengan hot reload |
| `npm run dev:api` / `npm run dev:web` | Jalankan terpisah |
| `npm run worker` | Worker produksi (setelah `npm run build`) |
| `npm run db:migrate` | `prisma migrate deploy` + generate client |
| `npm run db:migrate:dev` | Buat migration baru saat mengubah schema |
| `npm run db:seed` | Seed idempoten |
| `npm run build` | Build API (tsup) dan web (vite) |
| `npm run typecheck` / `npm run lint` | Pemeriksaan TypeScript dan ESLint |
| `npm test` | Test API + web |
| `npm run e2e` | Playwright (butuh stack dev berjalan & data seed) |

> Untuk dev satu proses tanpa worker terpisah: `WORKER_INLINE=true npm run dev:api`.

## Peran

| Peran | Ringkas |
|---|---|
| Administrator | Pengguna, peran & izin, konfigurasi, provider AI, templat, audit. **Tidak** otomatis membaca isi surat. |
| Petugas TU | Unggah, verifikasi, registrasi, teruskan, arsip, finalisasi nomor surat keluar, laporan. |
| Pimpinan | Disposisi, pemeriksaan hasil, persetujuan surat keluar, laporan. |
| Pegawai | Tugas sendiri: progres, bukti, draf surat balasan. |
| Auditor | Baca register, audit log, laporan — tanpa mengubah data. |

Izin per peran dapat diubah admin (menu *Pengguna & Peran*). Semua otorisasi diperiksa di server,
termasuk akses per objek (surat rahasia, surat yang tidak terkait, dokumen privat).

## Dokumentasi

- [Arsitektur](docs/ARCHITECTURE.md)
- [Dokumentasi API](docs/API.md)
- [Provider AI & konfigurasi model](docs/AI_PROVIDERS.md)
- [Menambahkan templat DOCX](docs/TEMPLATES.md)
- [Deployment, backup/restore, troubleshooting](docs/OPERATIONS.md)
- [Pengujian](docs/TESTING.md)
- [Checklist pilot](docs/PILOT_CHECKLIST.md)

## Status

Lihat bagian *Status implementasi* di [`docs/PLAN.md`](docs/PLAN.md) untuk apa yang sudah selesai,
apa yang belum, dan keputusan yang menunggu persetujuan pemilik proses.
