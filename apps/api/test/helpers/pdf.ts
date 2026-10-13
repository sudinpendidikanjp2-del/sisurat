/**
 * Builds a minimal valid PDF with a real text layer (Helvetica), for tests of the local
 * text-extraction path. Pass no lines to get a PDF without text (simulates a scan).
 */
export function buildTextPdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = lines.length
    ? `BT /F1 11 Tf 14 TL 50 800 Td ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`
    : '0.9 g 50 50 400 600 re f';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export const SAMPLE_LETTER_LINES = [
  'PEMERINTAH KABUPATEN CONTOH',
  'DINAS PENDIDIKAN',
  'Jalan Merdeka No. 1, Kota Contoh',
  'Kota Contoh, 6 Oktober 2026',
  'Nomor : 005/123/DISDIK/2026',
  'Lampiran : 1 (satu) berkas',
  'Perihal : Undangan Rapat Koordinasi',
  'Kepada Yth. Kepala Kantor Contoh',
  'di Tempat',
  'Dengan hormat,',
  'Dalam rangka evaluasi program semester ganjil, kami mengundang Bapak/Ibu untuk hadir pada rapat koordinasi.',
  'Hari/Tanggal : Senin, 20 Oktober 2026',
  'Waktu : 09.00 WIB',
  'Tempat : Aula Dinas Pendidikan',
  'Atas perhatian Bapak/Ibu kami ucapkan terima kasih.',
  'Kepala Dinas',
];
