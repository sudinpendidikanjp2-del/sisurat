# Pengujian

## Ringkasan

| Lapisan | Lokasi | Perintah | Kebutuhan |
|---|---|---|---|
| API (unit + integrasi) | `apps/api/test/*.test.ts` | `npm run test:api` | PostgreSQL; database uji `sisurat_test` |
| Web (unit/komponen) | `apps/web/src/**/*.test.ts(x)` | `npm run test:web` | — |
| End-to-end | `tests/e2e/*.spec.ts` | `npm run e2e` | Stack dev berjalan + data seed |

Tidak ada pengujian yang membutuhkan API key sungguhan: provider AI diganti `MockProvider` dan OCR
dengan `MockOcr` (`apps/api/test/helpers/context.ts`).

## API

Siapkan database uji (sekali):

```bash
createdb -O sisurat sisurat_test      # atau via docker exec ke container db
npm run test:api
```

`TEST_DATABASE_URL` dapat mengganti default `postgresql://sisurat:sisurat@localhost:5432/sisurat_test`.
Migration diterapkan otomatis (`test/globalSetup.ts`); setiap berkas test mengosongkan tabel lalu seed ulang.

Cakupan:

| Berkas | Isi |
|---|---|
| `auth.test.ts` | Hash scrypt, login/logout, cookie httpOnly, CSRF, lockout, ganti & reset kata sandi |
| `authorization.test.ts` | Izin per peran, admin tidak membaca isi surat, cakupan pegawai, surat rahasia, akses dokumen privat + audit, perubahan izin, API key tidak bocor |
| `letters.test.ts` | Validasi upload (tipe, ekstensi, ukuran, PDF rusak), registrasi manual, nomor agenda berurutan, duplikat, Idempotency-Key, koreksi pasca-verifikasi, audit dipotong, pembatalan, filter & paginasi |
| `extraction.test.ts` | PDF digital tanpa AI, teks-saja ke AI, konflik, AI visual + pencatatan token/biaya, field kosong/ambigu, duplikat, kebijakan RAHASIA, tanpa fallback otomatis, Claude eksplisit, Tesseract, timeout + retry, maxAttempts, idempotensi job, job terlambat tidak menimpa data terverifikasi, koreksi nilai AI |
| `ai-unit.test.ts` | Parser tanggal, normalisasi, keamanan prompt, deteksi teks PDF, format nomor, CSV injection |
| `dispositions.test.ts` | Teruskan, alur lengkap disposisi → revisi → setujui → arsip, multi-pelaksana, alih tugas, pembatalan, daftar tugas, notifikasi tenggat (dedupe) |
| `outgoing.test.ts` | Templat 5 jenis, deteksi tag terpecah, versi templat, field wajib, siklus draft → revisi → setuju → final bernomor, isi DOCX, versi dokumen, balasan dari disposisi |
| `reports.test.ts` | Dashboard kosong & berisi data nyata, cakupan, laporan, ekspor CSV aman + audit, audit log, validasi pengaturan |

## End-to-end

```bash
docker compose up -d db
SEED_DEMO_PASSWORD=DemoPass123 npm run setup
WORKER_INLINE=true npm run dev:api &   # atau npm run dev
npm run dev:web &
npm run e2e                           # E2E_PASSWORD=DemoPass123 (default), E2E_BASE_URL=http://localhost:5173
```

Skenario `main-flow.spec.ts`: TU mengunggah PDF digital → draft terisi dari teks lokal → verifikasi →
teruskan → pimpinan memberi disposisi → pegawai memulai, mengisi progres, mengajukan → pimpinan menyetujui
→ surat selesai. Ditambah uji penolakan akses halaman admin (proyek desktop & mobile).

Playwright memakai Chromium yang sudah terpasang (`PLAYWRIGHT_BROWSERS_PATH`) atau jalankan
`npx playwright install chromium` di mesin sendiri.
