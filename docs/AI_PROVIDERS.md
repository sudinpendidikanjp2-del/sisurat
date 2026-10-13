# Provider AI, OCR, dan Konfigurasi Model

## Ringkasan

| Komponen | Kode | Data yang dikirim | Default |
|---|---|---|---|
| Ekstraksi teks PDF lokal + parser heuristik | `ai/pdfText.ts`, `ai/heuristics.ts` | Tidak ada (lokal) | Selalu aktif |
| Gemini API | `ai/providers/gemini.ts` (`@google/genai`) | Teks hasil ekstraksi (PDF digital) **atau** berkas (scan/gambar) | Nonaktif, belum disetujui |
| Claude API | `ai/providers/claude.ts` (`@anthropic-ai/sdk`) | Sama seperti Gemini | Nonaktif, belum disetujui |
| Tesseract OCR | `ai/providers/tesseract.ts` (CLI) | Tidak ada (lokal) | Aktif bila biner terpasang |

Semua provider berada di balik `DocumentAIService` (`ai/documentAiService.ts`). Logika register,
verifikasi, dan disposisi tidak bergantung pada provider tertentu.

## Mengaktifkan provider eksternal (Gemini/Claude)

1. **Keputusan organisasi** (lihat PRD §12, §22): tinjau syarat penggunaan data, retensi, penggunaan
   untuk pelatihan, subprosesor, lokasi pemrosesan, dan **perbedaan tier gratis vs berbayar**.
   Gunakan akun/tier berbayar yang ketentuan datanya disetujui.
2. Set API key di environment server (bukan di database/UI):
   ```
   GEMINI_API_KEY=...
   CLAUDE_API_KEY=...
   ```
   Restart API dan worker.
3. Login sebagai admin → *Konfigurasi & AI*:
   - Centang **Izinkan pemrosesan AI eksternal**.
   - Pilih **Provider utama**.
   - Pada kartu provider: **Aktifkan**, centang **persetujuan organisasi**, pilih **klasifikasi yang boleh dikirim**
     (mis. hanya *Biasa*). Surat *Rahasia* tidak pernah dikirim kecuali dicentang eksplisit.
   - Isi **model**, timeout, maksimal percobaan, dan **tarif per 1 juta token** (dari halaman harga resmi)
     agar estimasi biaya muncul di dashboard/laporan.
4. Semua perubahan tercatat di audit log (`settings.updated`, `ai_provider.updated`).

Tidak ada fallback lintas provider otomatis. Claude dipakai bila dipilih sebagai provider utama atau
diminta eksplisit oleh petugas (*Proses ulang → Claude*) — tetap tunduk pada kebijakan provider tersebut.

## Model

Nama model dikonfigurasi, bukan di-hardcode dalam logika bisnis:

- Default seed: `GEMINI_MODEL=gemini-2.5-flash`, `CLAUDE_MODEL=claude-opus-5-5`.
- **Periksa dokumentasi resmi** sebelum produksi; nama/ketersediaan model dapat berubah.
  Ubah di UI (kartu provider) atau env sebelum seed pertama.
- Pilih model berdasarkan uji akurasi pada 30–50 surat contoh, biaya, batas halaman, dan kebijakan data
  (PRD §17, §20). Bandingkan provider pada sampel yang sama.

## Detail implementasi

- **Prompt** (`ai/prompt.ts`, versi `PROMPT_VERSION` disimpan di setiap job): system prompt tetap yang
  menyatakan isi dokumen adalah data tidak tepercaya, melarang mengarang, dan meminta `null` + `uncertain_fields`.
  Teks lokal dibungkus `<dokumen>…</dokumen>` (tag penutup di dalam dokumen dihapus).
- **Structured output**: Gemini `responseMimeType: application/json` + `responseJsonSchema`; Claude
  `output_config.format` (`json_schema`) dengan server-side refusal fallback (`fallbacks: "default"`,
  beta `server-side-fallback-2026-07-01`) ke model Claude lain bila model utama menolak.
- **Normalisasi** (`ai/normalize.ts`): validasi objek, tanggal Indonesia/ISO → `YYYY-MM-DD` hanya bila
  lengkap, nilai seperti "-", "tidak diketahui" → `null`, flag `MISSING`, `AMBIGUOUS`, `INVALID_FORMAT`,
  `CONFLICT` (teks lokal vs AI), `DUPLICATE_SUSPECT`. **Tidak ada skor kepercayaan** yang ditampilkan
  sebagai probabilitas akurasi.
- **Retry**: `TIMEOUT`, `RATE_LIMITED` (menghormati `Retry-After`), `UNAVAILABLE` (5xx/jaringan),
  `INVALID_RESPONSE` → antre ulang dengan backoff 5 dtk × 2^(n-1), maks. 10 menit, sampai `maxAttempts`.
  `AUTH_FAILED`, `BAD_REQUEST`, `NOT_CONFIGURED`, `NO_ALLOWED_PROVIDER` → gagal permanen.
  Retry SDK dimatikan (`maxRetries: 0`) agar percobaan dihitung & diaudit oleh antrean.
- **Pencatatan**: provider, model, versi prompt, metode, durasi, token input/output, halaman, estimasi biaya,
  kode error (tanpa isi dokumen).
- **Retensi**: `rawOutput` dihapus otomatis setelah `rawResultRetentionDays` (default 90 hari); metadata
  ternormalisasi dan koreksi tetap untuk audit.

## Tesseract (OCR lokal)

Pasang di server (Debian/Ubuntu):

```bash
sudo apt-get install tesseract-ocr tesseract-ocr-ind poppler-utils
```

Image Docker `api` sudah memuatnya. Atur `TESSERACT_LANG` (default `ind+eng`). Kualitas harus diuji pada
surat kantor (stempel, tata letak, scan miring). Tesseract dipakai untuk scan bila tidak ada provider AI
eksternal yang diizinkan; dapat dinonaktifkan di kartu provider.

## Menambah provider baru

1. Implementasikan `StructuredExtractionProvider` (`ai/types.ts`): `isConfigured`, `supports`, `extract`
   (kembalikan objek JSON sesuai `extractionJsonSchema()`, petakan error ke `ProviderError`).
2. Tambahkan nilai enum `AiProvider` di `prisma/schema.prisma` + migration, dan di `packages/shared/src/enums.ts`.
3. Daftarkan di `ai/factory.ts` dan seed baris `AiProviderConfig`.
4. Tambahkan test dengan provider tiruan (`test/helpers/context.ts` → `MockProvider`).
