import { expect, test, type Page } from '@playwright/test';
import { buildTextPdf } from '../../apps/api/test/helpers/pdf';

const PASSWORD = process.env.E2E_PASSWORD ?? 'DemoPass123';
const unique = Date.now().toString().slice(-6);

async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('Nama pengguna').fill(username);
  await page.getByLabel('Kata sandi').fill(PASSWORD);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.getByRole('button', { name: 'Keluar' })).toBeVisible();
}

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Keluar' }).click();
  await expect(page.getByRole('button', { name: 'Masuk' })).toBeVisible();
}

test('surat masuk: unggah → verifikasi → disposisi → tindak lanjut → disetujui', async ({ page }) => {
  const letterNo = `E2E/${unique}/2026`;
  const pdf = buildTextPdf([
    'PEMERINTAH KABUPATEN CONTOH',
    'DINAS KOMUNIKASI DAN INFORMATIKA',
    'Kota Contoh, 9 Oktober 2026',
    `Nomor : ${letterNo}`,
    'Lampiran : -',
    `Perihal : Undangan Uji Coba ${unique}`,
    'Kepada Yth. Kepala Kantor Contoh',
    'Dengan hormat,',
    'Kami mengundang Bapak/Ibu untuk menghadiri uji coba sistem.',
  ]);

  // 1. TU uploads a digital PDF; local text extraction pre-fills the draft.
  await login(page, 'tu');
  await page.getByRole('link', { name: 'Surat Masuk', exact: true }).click();
  await page.getByRole('button', { name: 'Unggah surat' }).click();
  await page.getByLabel('Pilih berkas surat').setInputFiles({ name: 'undangan.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.getByRole('button', { name: 'Simpan & lanjut verifikasi' }).click();
  await expect(page.getByRole('heading', { name: 'Verifikasi metadata surat' })).toBeVisible();
  await expect(page.getByLabel(/Nomor surat/)).toHaveValue(letterNo, { timeout: 30_000 });
  await expect(page.getByLabel(/^Perihal/)).toHaveValue(`Undangan Uji Coba ${unique}`);
  await page.getByRole('button', { name: 'Konfirmasi & daftarkan' }).click();
  await expect(page.getByText(/No\. Agenda \d{4}\/AG\//)).toBeVisible();
  const letterUrl = page.url();

  // 2. Forward to the leader.
  await page.getByRole('button', { name: 'Teruskan' }).click();
  await page.getByLabel(/Pimpinan \/ pejabat disposisi/).selectOption({ label: 'Budi Santoso (contoh) — Kepala Kantor' });
  await page.getByRole('dialog').getByRole('button', { name: 'Teruskan' }).click();
  await expect(page.getByText('Menunggu disposisi').first()).toBeVisible();
  await logout(page);

  // 3. Leader gives a disposition.
  await login(page, 'pimpinan');
  await page.goto(letterUrl);
  await page.getByRole('button', { name: 'Beri disposisi' }).click();
  await page.getByLabel(/Arahan \/ instruksi/).fill('Hadiri dan laporkan hasilnya');
  await page.getByLabel(/Andi Pratama/).check();
  await page.getByRole('button', { name: 'Kirim disposisi' }).click();
  await expect(page.getByText('Ditugaskan').first()).toBeVisible();
  await logout(page);

  // 4. Staff works on the task and submits.
  await login(page, 'pegawai1');
  await page.getByRole('link', { name: 'Tugas Saya', exact: true }).click();
  await page.getByRole('link', { name: `Undangan Uji Coba ${unique}` }).click();
  await page.getByRole('button', { name: 'Mulai kerjakan' }).click();
  await page.getByLabel(/Catatan progres/).fill('Sudah hadir, notulen terlampir');
  await page.getByLabel('Progres (%)').fill('100');
  await page.getByLabel(/ajukan untuk pemeriksaan/).check();
  await page.getByRole('button', { name: 'Ajukan hasil' }).click();
  await expect(page.getByText('Menunggu pemeriksaan').first()).toBeVisible();
  const taskUrl = page.url();
  await logout(page);

  // 5. Leader approves; the letter becomes completed.
  await login(page, 'pimpinan');
  await page.goto(taskUrl);
  await page.getByRole('button', { name: 'Setujui' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Setujui' }).click();
  await expect(page.getByText('Selesai').first()).toBeVisible();
  await page.goto(letterUrl);
  await expect(page.getByText('Selesai').first()).toBeVisible();
});

test('pegawai tidak dapat membuka halaman administrasi @mobile', async ({ page }) => {
  await login(page, 'pegawai2');
  await page.goto('/admin/pengguna');
  await expect(page.getByRole('heading', { name: 'Akses ditolak' })).toBeVisible();
  await page.goto('/surat-masuk/baru');
  await expect(page.getByRole('heading', { name: 'Akses ditolak' })).toBeVisible();
});
