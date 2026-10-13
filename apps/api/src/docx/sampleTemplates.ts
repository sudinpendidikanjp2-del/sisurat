import PizZip from 'pizzip';
import type { OutgoingType } from '@sisurat/shared';

/**
 * Builds small sample DOCX templates for development/demo. They are clearly marked as samples:
 * the organisation must upload its official templates (see docs/TEMPLATES.md).
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function para(text: string, opts: { bold?: boolean; center?: boolean; size?: number } = {}) {
  const ppr = opts.center ? '<w:pPr><w:jc w:val="center"/></w:pPr>' : '';
  const rpr = `<w:rPr>${opts.bold ? '<w:b/>' : ''}${opts.size ? `<w:sz w:val="${opts.size}"/>` : ''}</w:rPr>`;
  const runs = text.split('\t').map((t) => `<w:t xml:space="preserve">${esc(t)}</w:t>`).join('<w:tab/>');
  return `<w:p>${ppr}<w:r>${rpr}${runs}</w:r></w:p>`;
}

export function buildDocx(lines: (string | { text: string; bold?: boolean; center?: boolean; size?: number })[]): Buffer {
  const body = lines.map((l) => (typeof l === 'string' ? para(l) : para(l.text, l))).join('');
  const zip = new PizZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const HEADER = [
  { text: 'CONTOH TEMPLAT — BUKAN TEMPLAT RESMI', bold: true, center: true, size: 18 },
  { text: '{nama_instansi}', bold: true, center: true, size: 28 },
  '',
];
const SIGN = ['', '{penandatangan_jabatan}', '', '', '{penandatangan_nama}'];

export const SAMPLE_TEMPLATES: Record<OutgoingType, { name: string; lines: Parameters<typeof buildDocx>[0] }> = {
  UNDANGAN: {
    name: 'Surat Undangan (contoh)',
    lines: [
      ...HEADER,
      'Nomor\t: {nomor}',
      'Hal\t: Undangan {acara}',
      '{tempat_tanggal_surat}',
      '',
      'Yth. {tujuan}',
      '',
      'Dengan hormat, kami mengundang Bapak/Ibu untuk menghadiri {acara} yang akan dilaksanakan pada:',
      'Hari/Tanggal\t: {hari_tanggal}',
      'Waktu\t: {waktu}',
      'Tempat\t: {tempat}',
      'Agenda\t: {agenda}',
      'Atas perhatian dan kehadirannya kami ucapkan terima kasih.',
      ...SIGN,
    ],
  },
  TUGAS: {
    name: 'Surat Tugas (contoh)',
    lines: [
      ...HEADER,
      { text: 'SURAT TUGAS', bold: true, center: true },
      { text: 'Nomor: {nomor}', center: true },
      '',
      'Yang bertanda tangan di bawah ini menugaskan:',
      'Nama\t: {nama_pegawai}',
      'Jabatan\t: {jabatan_pegawai}',
      'Untuk\t: {maksud_tugas}',
      'Lokasi\t: {lokasi}',
      'Tanggal\t: {tanggal_pelaksanaan}',
      'Demikian surat tugas ini dibuat untuk dilaksanakan dengan penuh tanggung jawab.',
      '{tempat_tanggal_surat}',
      ...SIGN,
    ],
  },
  KETERANGAN: {
    name: 'Surat Keterangan (contoh)',
    lines: [
      ...HEADER,
      { text: 'SURAT KETERANGAN', bold: true, center: true },
      { text: 'Nomor: {nomor}', center: true },
      '',
      'Yang bertanda tangan di bawah ini menerangkan bahwa:',
      '{identitas_pihak}',
      '{isi_keterangan}',
      'Demikian surat keterangan ini dibuat untuk dipergunakan sebagaimana mestinya.',
      '{tempat_tanggal_surat}',
      ...SIGN,
    ],
  },
  NOTA_DINAS: {
    name: 'Nota Dinas (contoh)',
    lines: [
      ...HEADER,
      { text: 'NOTA DINAS', bold: true, center: true },
      'Nomor\t: {nomor}',
      'Kepada\t: {kepada}',
      'Dari\t: {dari}',
      'Tanggal\t: {tanggal}',
      'Sifat\t: {sifat}',
      'Lampiran\t: {lampiran}',
      'Hal\t: {hal}',
      '',
      '{isi}',
      ...SIGN,
    ],
  },
  PENGANTAR: {
    name: 'Surat Pengantar (contoh)',
    lines: [
      ...HEADER,
      { text: 'SURAT PENGANTAR', bold: true, center: true },
      { text: 'Nomor: {nomor}', center: true },
      '',
      'Yth. {tujuan}',
      'Bersama ini kami sampaikan:',
      '{daftar_dokumen}',
      'Jumlah\t: {jumlah}',
      'Keterangan\t: {keterangan}',
      '{tempat_tanggal_surat}',
      ...SIGN,
    ],
  },
};
