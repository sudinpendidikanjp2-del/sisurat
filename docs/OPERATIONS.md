# Operasional: Deployment, Backup & Restore, Troubleshooting

## Deployment

### Komponen

| Proses | Perintah | Catatan |
|---|---|---|
| API | `node apps/api/dist/server.js` | Port `PORT` (default 3000), hanya `/api/*` |
| Worker | `node apps/api/dist/worker.js` | Wajib berjalan agar ekstraksi, pengingat tenggat, dan retensi diproses. Aman dijalankan lebih dari satu instans. |
| Web | berkas statis `apps/web/dist` | Disajikan reverse proxy; `/api` diproksikan ke API pada **origin yang sama** |
| PostgreSQL | 14+ (diuji 16) | |
| Penyimpanan | direktori `DOCUMENT_STORAGE_PATH` | Privat, di luar web root, ikut dibackup |

### Langkah (server Linux)

```bash
git clone <repo> sisurat && cd sisurat
npm ci
cp .env.example apps/api/.env      # isi DATABASE_URL, COOKIE_SECURE=true, TRUST_PROXY=true, path storage, API key bila disetujui
npm run db:migrate                 # prisma migrate deploy (jangan gunakan db push di produksi)
NODE_ENV=production SEED_ADMIN_PASSWORD='<kuat>' npm run db:seed   # sekali; tanpa data contoh
npm run build
# jalankan API & worker dengan systemd/pm2, web dist via nginx (lihat deploy/nginx.conf)
```

Wajib di produksi:

- **HTTPS** (TLS di nginx/Caddy/load balancer). Set `COOKIE_SECURE=true` (API menolak start tanpa ini
  saat `NODE_ENV=production`) dan `TRUST_PROXY=true` bila di belakang proxy.
- `DATABASE_URL` eksplisit (API menolak start tanpa ini di production).
- Direktori storage dimiliki user layanan, mode `700`.
- Login admin pertama → ganti kata sandi (dipaksa sistem) → buat akun pengguna → nonaktifkan templat contoh.

### Docker (opsional)

```bash
docker compose --profile app up -d --build    # db + api + worker + web (nginx) di http://127.0.0.1:8080
docker compose exec api node dist/seed/seed.js # seed (set SEED_ADMIN_PASSWORD)
```

Image `api` memuat Tesseract + bahasa Indonesia dan poppler. Untuk produksi, letakkan TLS di depan
layanan `web` dan set `COOKIE_SECURE=true`.

> Catatan: Dockerfile dan profil `app` belum diuji di lingkungan pengembangan ini (tidak ada Docker daemon);
> jalur yang telah diuji adalah instalasi Node + PostgreSQL langsung.

## Backup

Yang harus dibackup **bersamaan** (konsisten satu titik waktu):

1. Database PostgreSQL.
2. Direktori `DOCUMENT_STORAGE_PATH` (dokumen asli, lampiran, DOCX hasil, templat).

Contoh harian:

```bash
#!/usr/bin/env bash
set -euo pipefail
TS=$(date +%Y%m%d-%H%M)
DEST=/backup/sisurat/$TS
mkdir -p "$DEST"
pg_dump --format=custom --no-owner "$DATABASE_URL" > "$DEST/db.dump"
tar -C "$DOCUMENT_STORAGE_PATH" -czf "$DEST/storage.tar.gz" .
sha256sum "$DEST"/* > "$DEST/SHA256SUMS"
# enkripsi & salin ke lokasi lain (offsite), mis. gpg/age + rclone
find /backup/sisurat -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +
```

Rekomendasi: enkripsi backup, simpan salinan di lokasi terpisah, uji restore minimal bulanan,
retensi sesuai kebijakan arsip (keputusan pemilik proses).

## Restore

```bash
systemctl stop sisurat-api sisurat-worker
createdb sisurat_restore
pg_restore --no-owner --dbname=sisurat_restore /backup/sisurat/<TS>/db.dump
mkdir -p /srv/sisurat/storage-restore && tar -C /srv/sisurat/storage-restore -xzf /backup/sisurat/<TS>/storage.tar.gz
# arahkan DATABASE_URL & DOCUMENT_STORAGE_PATH ke hasil restore, lalu:
npm run db:migrate        # menerapkan migration yang lebih baru bila ada
systemctl start sisurat-api sisurat-worker
```

Verifikasi: login, buka beberapa surat dan pratinjau dokumen, cek `GET /api/health`, cek audit log terbaru.
Checksum dokumen tersimpan di kolom `Document.checksumSha256` untuk pemeriksaan integritas.

## Retensi & penghapusan

- Hasil mentah AI (`ExtractionResult.rawOutput`) dihapus otomatis oleh worker setelah `rawResultRetentionDays`.
- Surat draft yang dibatalkan di-*soft delete*; dokumen asli tetap ada untuk audit.
- Penghapusan permanen dokumen/surat **belum** disediakan melalui UI — memerlukan kebijakan retensi resmi
  (keputusan pemilik proses) sebelum diimplementasikan.

## Pemantauan

- `GET /api/health` (cek koneksi DB) untuk uptime check.
- Log JSON (pino) di stdout untuk API dan worker; tidak berisi isi surat, cookie, atau header otorisasi.
- Dashboard → *Gagal OCR/AI* dan Laporan → *Pemrosesan OCR/AI* untuk tingkat kegagalan & biaya.

## Troubleshooting

| Gejala | Penyebab umum | Solusi |
|---|---|---|
| `Can't reach database server` | PostgreSQL belum jalan / `DATABASE_URL` salah | `docker compose up -d db`; cek kredensial |
| Ekstraksi tetap “Dalam antrean” | Worker tidak berjalan | Jalankan `npm run worker` (atau `WORKER_INLINE=true` di dev) |
| Job gagal `NO_ALLOWED_PROVIDER` | Dokumen scan & AI eksternal tidak diizinkan, Tesseract tidak ada | Isi manual, pasang Tesseract, atau setujui provider di Konfigurasi |
| Job gagal `AUTH_FAILED` | API key salah/tidak aktif | Periksa env `GEMINI_API_KEY`/`CLAUDE_API_KEY`, restart API & worker |
| Job gagal `BAD_REQUEST` | Nama model tidak valid / berkas ditolak provider | Periksa nama model di dokumentasi resmi provider |
| Banyak `RATE_LIMITED` | Kuota provider | Kurangi volume, naikkan tier, atau tambah `maxAttempts` |
| Login selalu “Token keamanan tidak valid” | Akses lintas origin / cookie diblokir | Akses web dan API pada origin yang sama (proxy `/api`) |
| Tidak bisa login setelah beberapa kali salah | Kunci akun 15 menit | Tunggu, atau admin → Pengguna → buka kunci |
| Login gagal di produksi lewat HTTP | `COOKIE_SECURE=true` butuh HTTPS | Gunakan HTTPS |
| Pratinjau PDF kosong | Browser tanpa penampil PDF / plugin diblokir | Gunakan tombol *Buka di tab baru* atau *Unduh* |
| `prisma generate` gagal saat install (mis. `Cannot find module …\\node_modules\\node_modules\\prisma\\build\\index.js` di Windows/Yarn) | Versi lama menjalankan `prisma generate` dari dalam workspace | Tarik versi terbaru (generate kini dijalankan dari root), hapus `node_modules`, install ulang; atau jalankan `npm run db:generate` dari root |
| Upload ditolak “tidak sesuai dengan isinya” | Ekstensi tidak cocok dengan isi (mis. PNG bernama .pdf) | Simpan ulang berkas dengan format yang benar |
