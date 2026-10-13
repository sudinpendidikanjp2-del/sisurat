# Checklist Pilot

## Keputusan pemilik proses (wajib sebelum pilot)

- [ ] Kebijakan pengiriman surat ke AI eksternal: diizinkan/tidak, kategori & klasifikasi yang dilarang,
      provider & tier layanan, lokasi pemrosesan, retensi data provider.
- [ ] Format nomor agenda internal dan nomor surat keluar resmi (atur di *Konfigurasi*).
- [ ] Pejabat yang berwenang memverifikasi metadata, memeriksa tindak lanjut, dan menyetujui surat keluar
      (sesuaikan izin peran).
- [ ] Kebijakan retensi arsip, hasil mentah AI, dan prosedur penghapusan.
- [ ] Templat DOCX resmi kelima jenis surat beserta penyetujunya.
- [ ] Batas ukuran berkas & jumlah halaman yang lazim.
- [ ] Dukungan tulisan tangan (di luar MVP kecuali disepakati).

## Infrastruktur

- [ ] Server dengan HTTPS, PostgreSQL, direktori storage privat, worker sebagai layanan.
- [ ] `COOKIE_SECURE=true`, `TRUST_PROXY=true`, `DATABASE_URL`, secret di secret manager/env.
- [ ] Backup harian DB + storage terenkripsi dan offsite; **uji restore** dilakukan.
- [ ] Pemantauan `GET /api/health` dan log.
- [ ] Tesseract + data bahasa Indonesia terpasang bila OCR lokal dipakai.

## Konfigurasi aplikasi

- [ ] Admin mengganti kata sandi awal; akun pengguna dibuat dengan peran yang tepat.
- [ ] Templat contoh dinonaktifkan; templat resmi diunggah dan label placeholder dipetakan.
- [ ] Provider AI: model dipilih dari dokumentasi resmi, tarif token diisi, klasifikasi yang diizinkan dibatasi.
- [ ] Data contoh tidak ada di database produksi (`NODE_ENV=production` melewati seed demo).

## Uji kualitas (30–50 surat contoh, PRD §17 & §20)

- [ ] Siapkan sampel berlabel: PDF digital, scan jelas, scan buram/miring, foto.
- [ ] Ukur per provider pada sampel yang sama: akurasi nomor, tanggal, pengirim, perihal; tingkat koreksi
      (Laporan → Koreksi per field); waktu sampai siap verifikasi; tingkat kegagalan; biaya per surat.
- [ ] Uji kebijakan: surat RAHASIA tidak terkirim ke provider (lihat job → metode/provider).
- [ ] Uji kegagalan: matikan jaringan/API key → job gagal, berkas tetap ada, jalur manual berfungsi.

## Uji alur kerja

- [ ] Registrasi manual tanpa AI.
- [ ] Disposisi ke beberapa pegawai, tenggat, notifikasi, revisi, persetujuan, arsip.
- [ ] Surat balasan dari disposisi, persetujuan, finalisasi nomor, unduh DOCX.
- [ ] Akses: pegawai tidak melihat surat lain; auditor tidak dapat mengubah; admin tidak membaca isi surat.
- [ ] Audit log mencatat unggah, verifikasi, disposisi, persetujuan, ekspor, perubahan izin.
- [ ] Pelatihan singkat TU, pimpinan, pegawai; kumpulkan masukan UX.
