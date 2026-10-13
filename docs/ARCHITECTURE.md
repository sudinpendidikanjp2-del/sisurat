# Arsitektur

## Gambaran umum

Modular monolith dalam satu monorepo:

```
Browser ──(same-origin /api, cookie sesi httpOnly + header X-CSRF-Token)──► Fastify API
                                                                            │
     ┌──────────────────────────────────────────────────────────────────────┤
     │ modules/*      route → service (business rules, transaksi) → Prisma   │
     │ plugins/auth   sesi, CSRF, guard izin                                 │
     │ lib/authz      RBAC + cakupan baca per objek                          │
     │ lib/audit      audit log tersanitasi                                  │
     │ storage/       penyimpanan privat (storage key) + validasi berkas     │
     │ ai/            DocumentAIService + provider (Gemini, Claude, Tesseract)│
     │ docx/          deteksi placeholder & render DOCX                       │
     │ jobs/          antrean ekstraksi, pengingat tenggat, retensi          │
     └──────────────────────────────────────────────────────────────────────┘
                     │                                   │
               PostgreSQL                     Disk privat (DOCUMENT_STORAGE_PATH)
                     ▲
             Worker (proses terpisah: `node dist/worker.js`)
```

## Prinsip yang diterapkan

| Prinsip | Implementasi |
|---|---|
| Status OCR terpisah dari status bisnis | `IncomingLetter.processingStatus` (UPLOADED…VERIFIED) vs `IncomingLetter.status` (DRAFT…ARCHIVED). |
| Hasil AI terpisah dari metadata final | `ExtractionResult` (mentah + normalisasi + flag + evidence). Kolom metadata surat hanya diisi saat verifikasi; worker tidak pernah menimpa surat yang sudah `VERIFIED`. |
| Dokumen asli tidak ditimpa | Nama berkas acak (UUID), `writeFile(..., { flag: 'wx' })`, checksum SHA-256, versi baru untuk DOCX hasil. |
| Jalur manual selalu tersedia | Surat dapat dibuat tanpa berkas/AI; kegagalan job → `PROCESSING_FAILED` + formulir manual. |
| Transaksi | Registrasi + nomor agenda, disposisi + penugasan, finalisasi surat keluar, perubahan status berantai. |
| Idempotensi | `Idempotency-Key` pada pembuatan surat; satu job aktif per dokumen (advisory lock); `ExtractionResult.jobId` unik; nomor dari `NumberSequence` atomik; `FOR UPDATE` saat verifikasi/finalisasi. |
| Provider dapat diganti | `StructuredExtractionProvider` & `OcrEngine`; router kebijakan di `DocumentAIService`. |
| Logika bisnis tidak di frontend | Frontend hanya menampilkan `actions` yang dihitung server; setiap aksi diotorisasi ulang di API. |

## Alur ekstraksi

1. `POST /api/incoming-letters` menyimpan berkas, membuat surat `DRAFT/UPLOADED`, lalu (bila diizinkan)
   `enqueueExtraction` → `ExtractionJob QUEUED`, surat `PROCESSING`.
2. Worker mengklaim job (`UPDATE … FOR UPDATE SKIP LOCKED`), membaca berkas dari storage.
3. `DocumentAIService.extractMetadata`:
   - PDF dengan teks memadai → parser heuristik lokal (`LOCAL_TEXT`). Bila field kunci lengkap, **tanpa AI**.
   - Selain itu, provider utama/terpilih dipakai **hanya** jika `aiEnabled`, provider `enabled`,
     `approvedForExternal`, klasifikasi surat termasuk `allowedConfidentiality`, dan API key ada.
     PDF digital mengirim **teks saja** (`AI_TEXT`); scan/gambar mengirim berkas (`AI_VISION`).
   - Scan tanpa provider yang diizinkan → Tesseract lokal bila aktif & terpasang (`LOCAL_OCR`).
   - Tidak ada → `NO_ALLOWED_PROVIDER` (gagal permanen, isi manual).
   - Tidak pernah berpindah otomatis ke provider eksternal lain.
4. Keluaran dinormalisasi (`normalizeOutput`): tanggal divalidasi, nilai placeholder → `null`,
   flag `MISSING/AMBIGUOUS/INVALID_FORMAT/CONFLICT/DUPLICATE_SUSPECT`.
5. Sukses → `ExtractionResult`, surat `NEEDS_REVIEW`, notifikasi. Gagal sementara (timeout, 429, 5xx,
   JSON tidak valid) → antre ulang dengan backoff eksponensial (menghormati `Retry-After`) sampai
   `maxAttempts`; gagal permanen → `PROCESSING_FAILED`.

## Status tindak lanjut

`recomputeLetterStatus` menurunkan status surat dari penugasan aktif:
`NEEDS_REVISION` > `WAITING_REVIEW` > `IN_PROGRESS` > (semua `COMPLETED` → `COMPLETED`) > `ASSIGNED`.
Hanya pemberi disposisi (atau pejabat dengan `disposition.review`) yang dapat menyetujui; pembaruan
dari pegawai tidak pernah menyelesaikan tugas.

## Keamanan

- Password: scrypt (N=2^15, r=8, p=1), kebijakan minimal 10 karakter campuran.
- Sesi: token acak 256-bit di cookie `httpOnly; SameSite=Lax` (+`Secure` di production); DB hanya
  menyimpan hash SHA-256. Kedaluwarsa geser (default 12 jam). Logout/ganti sandi mencabut sesi.
- CSRF: token per sesi wajib di header `X-CSRF-Token` untuk setiap request non-GET.
- Brute force: rate limit login per IP+username, kunci akun 15 menit setelah 5 kegagalan, pesan generik.
- Upload: deteksi tipe dari isi berkas, cocokkan ekstensi, batas ukuran/halaman/jumlah, PDF rusak/terenkripsi ditolak.
- Dokumen hanya lewat `GET /api/documents/:id/content` setelah cek akses objek; `no-store`, `nosniff`, audit unduh/lihat.
- Header keamanan via `@fastify/helmet`; CSV export kebal formula injection.
- Log aplikasi tidak memuat body/cookie; audit log memotong teks panjang dan menyamarkan field sensitif.
- Isi dokumen diperlakukan sebagai data tidak tepercaya: system prompt tetap, teks dibungkus `<dokumen>`,
  keluaran divalidasi skema, AI tidak dapat memicu aksi apa pun.

## Model data

Lihat `prisma/schema.prisma`. Entitas inti: `User`, `Role`, `Permission`, `RolePermission`, `UserRole`,
`Session`, `PasswordResetToken`, `Unit`, `IncomingLetter`, `Document`, `ExtractionJob`, `ExtractionResult`,
`MetadataCorrection`, `Disposition`, `Assignment`, `WorkUpdate`, `OutgoingLetter`, `OutgoingLetterLink`,
`DocumentTemplate`, `Notification`, `AuditLog`, `AiProviderConfig`, `AppSetting`, `NumberSequence`,
`IdempotencyRecord`. Soft delete (`deletedAt`) pada pengguna, surat, dokumen, surat keluar.
