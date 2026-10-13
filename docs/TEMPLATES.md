# Menambahkan Templat DOCX Surat Keluar

Sistem mengisi templat Word (`.docx`) resmi organisasi dengan `docxtemplater`, tanpa mengubah tata letak.
Lima jenis didukung: **Surat Undangan, Surat Tugas, Surat Keterangan, Nota Dinas, Surat Pengantar**.

> Seed pengembangan membuat lima templat bertanda **“CONTOH TEMPLAT — BUKAN TEMPLAT RESMI”**.
> Unggah templat resmi dan nonaktifkan templat contoh sebelum dipakai.

## 1. Siapkan dokumen Word

Tulis placeholder dengan kurung kurawal tunggal, huruf kecil/angka/garis bawah:

```
Nomor   : {nomor}
Hal     : Undangan {acara}
Yth. {tujuan}
Hari/Tanggal : {hari_tanggal}
...
{penandatangan_jabatan}

{penandatangan_nama}
```

Aturan:

- Nama tag: `[A-Za-z_][A-Za-z0-9_]*` — contoh `{nama_pegawai}`, `{tanggal_pelaksanaan}`.
- Tag sistem (diisi otomatis, tidak muncul di formulir):
  - `{nomor}` — nomor surat keluar. Pada draft berisi `[nomor diberikan saat finalisasi]`.
  - `{nama_instansi}` — dari *Konfigurasi → Nama instansi*.
- Format (huruf tebal, font, perataan) mengikuti format tag di Word. Hindari memecah satu tag dengan
  format berbeda di tengah nama; sistem tetap mendeteksi tag yang dipecah Word menjadi beberapa *run*.
- Baris baru di isian teks panjang dipertahankan.
- Jangan menaruh data pribadi contoh di templat.

Contoh placeholder per jenis (PRD §10):

| Jenis | Placeholder yang disarankan |
|---|---|
| Undangan | `tujuan, acara, hari_tanggal, waktu, tempat, agenda, penandatangan_*` |
| Surat Tugas | `nama_pegawai, jabatan_pegawai, maksud_tugas, lokasi, tanggal_pelaksanaan, penandatangan_*` |
| Surat Keterangan | `identitas_pihak, isi_keterangan, tanggal, penandatangan_*` |
| Nota Dinas | `kepada, dari, tanggal, sifat, lampiran, hal, isi, penandatangan_*` |
| Surat Pengantar | `tujuan, daftar_dokumen, jumlah, keterangan, penandatangan_*` |

## 2. Unggah

Admin → *Templat Surat* → pilih jenis, nama, penyetuju → pilih berkas → **Unggah**.

- Setiap unggahan untuk jenis yang sama menjadi **versi baru** (v1, v2, …). Versi lama tetap tersimpan;
  surat keluar mencatat versi templat yang dipakai.
- Placeholder terdeteksi otomatis; semua awalnya wajib.

## 3. Petakan label

Klik ikon pensil pada templat:

- Ubah **label** yang tampil di formulir (mis. `hari_tanggal` → “Hari, tanggal acara”).
- Tandai **wajib** / **teks panjang**.
- Isi **disetujui oleh** dan **berlaku mulai**; **nonaktifkan** versi lama bila perlu.

Menambah/menghapus tag memerlukan unggah versi baru (daftar tag harus sama dengan isi berkas).

## 4. Alur surat keluar

1. Penyusun memilih jenis & templat, mengisi data, menautkan surat masuk/disposisi → **draft v1** (DOCX).
2. Perubahan saat draft/revisi → versi DOCX baru (versi lama tetap).
3. **Ajukan pemeriksaan** → pemeriksa (pemberi disposisi terkait, atau pejabat dengan izin `outgoing.review`)
   **menyetujui** atau **meminta revisi**. Penyusun tidak dapat menyetujui suratnya sendiri.
4. Petugas TU **memfinalkan**: nomor dialokasikan dari format *Konfigurasi → Format nomor surat keluar*
   (token `{seq:N} {code} {yyyy} {yy} {mm} {roman_month}`; `{code}`: UND, ST, SK, ND, SP) dan DOCX final dibuat.
5. Pengesahan resmi (tanda tangan/cap/TTE) tetap mengikuti proses kantor — sistem tidak menganggap surat sah
   hanya karena berkas dibuat, dan tidak mengirim surat secara otomatis.

Konversi PDF belum disediakan (PRD: fitur tambahan bila dukungan server stabil; mis. LibreOffice headless).
