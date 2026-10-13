# Dokumentasi API

Basis URL: `/api` (same-origin dengan aplikasi web). Format JSON kecuali disebutkan lain.

## Konvensi

- **Autentikasi**: cookie `sisurat_sid` (httpOnly) dari `POST /api/auth/login`.
- **CSRF**: semua request selain GET/HEAD wajib header `X-CSRF-Token: <csrfToken>` (dari respons login atau `GET /api/auth/me`).
- **Idempotensi**: `POST /api/incoming-letters` menerima header `Idempotency-Key` (8–100 karakter `[A-Za-z0-9_-]`).
  Permintaan ulang dengan kunci sama mengembalikan respons pertama (`Idempotent-Replayed: true`).
- **Paginasi**: `?page=1&pageSize=20` (maks. 100) → `{ items, meta: { page, pageSize, total, totalPages } }`.
- **Tanggal**: `YYYY-MM-DD` untuk field tanggal; timestamp dalam ISO-8601.
- **Error**: `{ "error": { "code": "...", "message": "...", "details": ... } }`

| HTTP | code | Arti |
|---|---|---|
| 400 | `BAD_REQUEST` | Validasi gagal (`details`: daftar `{path, message}`) |
| 401 | `UNAUTHORIZED` / `INVALID_CREDENTIALS` | Belum login / kredensial salah |
| 403 | `FORBIDDEN` / `CSRF_INVALID` | Tidak berizin / token CSRF salah |
| 404 | `NOT_FOUND` | Tidak ada **atau di luar cakupan akses** (tidak dibedakan) |
| 409 | `CONFLICT` / `INVALID_STATE` | Duplikat / transisi status tidak valid |
| 413 | `PAYLOAD_TOO_LARGE` | Berkas terlalu besar |
| 423 | `ACCOUNT_LOCKED` | Akun dikunci sementara |
| 429 | `RATE_LIMITED` | Terlalu banyak permintaan |

## Autentikasi

| Metode | Endpoint | Izin | Keterangan |
|---|---|---|---|
| POST | `/auth/login` | publik | `{username, password}` → `{user, csrfToken}`; rate limit per IP+username; kunci 15 menit setelah 5 gagal |
| POST | `/auth/logout` | login | Mencabut sesi |
| GET | `/auth/me` | login | `{user, csrfToken}` |
| POST | `/auth/change-password` | login | `{currentPassword, newPassword}`; mencabut sesi lain |
| POST | `/auth/reset-password` | publik | `{token, newPassword}` (token sekali pakai dari admin) |

## Pengguna, peran, unit

| Metode | Endpoint | Izin |
|---|---|---|
| GET | `/users?q&role&active&page` | `user.manage` |
| GET | `/users/directory?role=LEADER\|STAFF…` | login (data minimal untuk pemilih) |
| POST | `/users` | `user.manage` — `{username, fullName, email?, position?, unitId?, roles[], password}` |
| PATCH | `/users/:id` | `user.manage` — termasuk `roles`, `isActive` |
| POST | `/users/:id/reset-token` | `user.manage` → `{token, resetPath, expiresAt}` (tampil sekali, 24 jam) |
| POST | `/users/:id/unlock` | `user.manage` |
| GET | `/roles` | `role.manage` atau `user.manage` → peran + katalog izin |
| PUT | `/roles/:id/permissions` | `role.manage` — `{permissions: string[]}` |
| GET/POST | `/units` | login / `user.manage` |

## Surat masuk

| Metode | Endpoint | Izin | Keterangan |
|---|---|---|---|
| GET | `/incoming-letters` | login (dibatasi cakupan) | Filter: `q, status, processingStatus, letterType, priority, sender, assigneeId, dateFrom, dateTo, archived, sort, order` |
| POST | `/incoming-letters` | `letter.create` | `multipart/form-data`: `files` (0..n, PDF/JPEG/PNG) + `metadata` (JSON string, field metadata opsional + `autoExtract`) → `201 {id, documents[], jobId}` |
| GET | `/incoming-letters/:id` | cakupan baca | Detail + dokumen + job/hasil ekstraksi + disposisi + koreksi + `actions` |
| GET | `/incoming-letters/:id/history` | cakupan baca | Audit terkait surat, job, disposisi, penugasan |
| PATCH | `/incoming-letters/:id` | `letter.update` | Ubah metadata; setelah terdaftar setiap perubahan dicatat sebagai `MetadataCorrection` |
| POST | `/incoming-letters/:id/documents` | `letter.create` | Tambah lampiran (multipart `files`) |
| POST | `/incoming-letters/:id/verify` | `letter.verify` | Wajib: `letterNumber, letterDate, receivedDate, senderName, recipientName, subject`; opsional `extractionResultId`, `confirmNotDuplicate`. Mendaftarkan + nomor agenda. `409` + `details.duplicates` bila nomor+pengirim sudah ada |
| POST | `/incoming-letters/:id/forward` | `letter.forward` | `{leaderId, note?}` |
| POST | `/incoming-letters/:id/archive` | `letter.archive` | `{note?}` |
| POST | `/incoming-letters/:id/cancel` | `letter.delete` | `{reason}` (draft → soft delete) |
| POST | `/documents/:id/extract` | `extraction.run` | `{provider?: GEMINI\|CLAUDE\|TESSERACT}` → `202 {jobId, created:true}` atau `200` job aktif yang sama |
| GET | `/extraction-jobs/:id` | cakupan baca | Status job, metode, provider, model, token, biaya, error, hasil |
| GET | `/documents/:id/content?download=1` | cakupan objek induk | Stream berkas privat (inline untuk PDF/gambar), diaudit |

## Disposisi & tindak lanjut

| Metode | Endpoint | Izin | Keterangan |
|---|---|---|---|
| POST | `/incoming-letters/:id/dispositions` | `disposition.create` | `{instruction, priority, dueDate?, assigneeIds[]}` |
| POST | `/dispositions/:id/cancel` | pemberi / `disposition.review` | `{reason}` |
| GET | `/assignments?scope=mine\|review\|all&status&overdue` | login | `review`: penugasan yang saya berikan |
| GET | `/assignments/:id` | pelaksana / pemberi / cakupan surat | Detail + riwayat + `actions` |
| POST | `/assignments/:id/start` | pelaksana (`assignment.work`) | |
| POST | `/assignments/:id/updates` | pelaksana (`assignment.work`) | JSON `{note, progressPercent?, submitForReview?}` atau multipart dengan `files` bukti |
| POST | `/assignments/:id/review` | pemberi / `disposition.review` | `{decision: APPROVE\|REQUEST_REVISION, note?}` (revisi wajib catatan) |
| POST | `/assignments/:id/cancel` | pemberi / `disposition.review` | `{reason}` |
| POST | `/assignments/:id/reassign` | pemberi / `disposition.review` | `{newAssigneeId, reason}` |

## Surat keluar & templat

| Metode | Endpoint | Izin | Keterangan |
|---|---|---|---|
| GET | `/templates?type&active` | `template.manage` / `outgoing.create` | |
| POST | `/templates` | `template.manage` | multipart: `file` (DOCX), `type`, `name`, `approvedByName?`, `activeFrom?` → versi baru |
| PATCH | `/templates/:id` | `template.manage` | `name, isActive, approvedByName, activeFrom, placeholders[]` (label/wajib) |
| GET | `/outgoing-letters?q&status&type` | login (cakupan) | |
| GET | `/outgoing-letters/review-queue` | `outgoing.review` | |
| POST | `/outgoing-letters` | `outgoing.create` | `{templateId, subject, recipient, data{}, incomingLetterIds[], dispositionId?, confidentiality}` → DOCX draft v1 |
| GET | `/outgoing-letters/:id` | cakupan | Detail + versi dokumen + riwayat + `actions` |
| PATCH | `/outgoing-letters/:id` | penyusun, status DRAFT/NEEDS_REVISION | Membuat versi dokumen baru |
| POST | `/outgoing-letters/:id/submit` | penyusun | → WAITING_REVIEW |
| POST | `/outgoing-letters/:id/review` | `outgoing.review` (bukan penyusun) | `{decision, note?}` |
| POST | `/outgoing-letters/:id/finalize` | `outgoing.finalize` | Status APPROVED → nomor + DOCX final |
| POST | `/outgoing-letters/:id/cancel` | penyusun / `outgoing.finalize` | `{reason}` |

## Sistem

| Metode | Endpoint | Izin |
|---|---|---|
| GET | `/dashboard?dateFrom&dateTo` | `dashboard.read` (data sesuai cakupan pengguna) |
| GET | `/reports/letters?dateFrom&dateTo&status&letterType&sender&assigneeId` | `report.read` |
| GET | `/reports/letters.csv?…` | `report.export` (diaudit) |
| GET | `/notifications?unread&page` · POST `/notifications/:id/read` · POST `/notifications/read-all` | login |
| GET | `/settings/public` | login |
| GET/PUT | `/settings` | `config.manage` |
| GET | `/ai-providers` | `config.manage` (hanya `credentialConfigured: boolean`, tidak pernah API key) |
| PUT | `/ai-providers/:provider` | `config.manage` |
| GET | `/audit-logs?action&entityType&entityId&actorId&dateFrom&dateTo` | `audit.read` |
| GET | `/health` | publik (cek DB) |
