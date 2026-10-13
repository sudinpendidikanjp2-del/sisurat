/**
 * Seed script. Idempotent: safe to run repeatedly; it never overwrites roles, settings or users
 * that already exist.
 *
 * - Always: permission catalogue, the five roles, default settings, AI provider rows (all external
 *   providers DISABLED and NOT approved), an `admin` account.
 * - Development only (NODE_ENV != production and SEED_DEMO_DATA=true): sample units, one demo user
 *   per role and five clearly-marked SAMPLE DOCX templates. No letters are created — dashboards show
 *   real data only.
 *
 * Passwords are never hard-coded: SEED_ADMIN_PASSWORD / SEED_DEMO_PASSWORD are used when set,
 * otherwise a random password is generated and printed once.
 */
import { randomBytes } from 'node:crypto';
import { DEFAULT_ROLE_PERMISSIONS, OUTGOING_TYPES, PERMISSIONS, ROLE_CODES, ROLE_LABELS, type RoleCode } from '@sisurat/shared';
import { env } from '../config/env';
import { createPrisma } from '../db';
import { hashPassword, sha256 } from '../lib/crypto';
import { DEFAULT_SETTINGS } from '../lib/settings';
import { LocalPrivateStorage } from '../storage/storage';
import { SAMPLE_TEMPLATES, buildDocx } from '../docx/sampleTemplates';
import { defaultPlaceholderDefs, detectPlaceholders } from '../docx/render';
import { MIME_BY_KIND } from '../storage/fileValidation';
import type { Db } from '../db';

function generatePassword() {
  // 16 chars, guaranteed lower/upper/digit.
  const base = randomBytes(12).toString('base64url');
  return `${base}Aa9`;
}

export async function seedBase(prisma: Db, opts: { adminPassword?: string; log?: (m: string) => void } = {}) {
  const log = opts.log ?? console.log;
  for (const [code, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({ where: { code }, create: { code, description }, update: { description } });
  }
  const perms = await prisma.permission.findMany();
  const permId = new Map(perms.map((p) => [p.code, p.id]));
  for (const code of ROLE_CODES) {
    const existing = await prisma.role.findUnique({ where: { code } });
    if (existing) continue;
    await prisma.role.create({
      data: {
        code,
        name: ROLE_LABELS[code],
        permissions: { create: DEFAULT_ROLE_PERMISSIONS[code].map((p) => ({ permissionId: permId.get(p)! })) },
      },
    });
    log(`Peran dibuat: ${code}`);
  }

  if (!(await prisma.appSetting.findUnique({ where: { key: 'app' } }))) {
    await prisma.appSetting.create({ data: { key: 'app', value: DEFAULT_SETTINGS } });
  }

  const providers = [
    { provider: 'GEMINI' as const, model: env.GEMINI_MODEL, enabled: false, timeoutMs: 90_000 },
    { provider: 'CLAUDE' as const, model: env.CLAUDE_MODEL, enabled: false, timeoutMs: 120_000 },
    { provider: 'TESSERACT' as const, model: 'tesseract', enabled: true, timeoutMs: 180_000 },
  ];
  for (const p of providers) {
    await prisma.aiProviderConfig.upsert({
      where: { provider: p.provider },
      create: {
        ...p,
        approvedForExternal: false,
        allowedConfidentiality: p.provider === 'TESSERACT' ? ['BIASA', 'TERBATAS', 'RAHASIA'] : [],
        maxAttempts: 3,
        notes:
          p.provider === 'TESSERACT'
            ? 'OCR lokal; dokumen tidak keluar dari server.'
            : 'Belum disetujui. Tinjau ketentuan data, retensi, lokasi pemrosesan, dan tier layanan sebelum mengaktifkan.',
      },
      update: {},
    });
  }

  let adminPassword: string | null = null;
  if (!(await prisma.user.findUnique({ where: { username: 'admin' } }))) {
    adminPassword = opts.adminPassword ?? generatePassword();
    const role = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
    await prisma.user.create({
      data: {
        username: 'admin',
        fullName: 'Administrator Sistem',
        passwordHash: await hashPassword(adminPassword),
        mustChangePassword: true,
        roles: { create: [{ roleId: role.id }] },
      },
    });
    log(`Akun admin dibuat (wajib ganti kata sandi saat login pertama).`);
  }
  return { adminPassword };
}

const DEMO_USERS: { username: string; fullName: string; position: string; unit: string; roles: RoleCode[] }[] = [
  { username: 'tu', fullName: 'Siti Rahma (contoh)', position: 'Pengadministrasi Umum', unit: 'TU', roles: ['REGISTRAR'] },
  { username: 'pimpinan', fullName: 'Budi Santoso (contoh)', position: 'Kepala Kantor', unit: 'PIM', roles: ['LEADER'] },
  { username: 'pegawai1', fullName: 'Andi Pratama (contoh)', position: 'Analis Program', unit: 'PRG', roles: ['STAFF'] },
  { username: 'pegawai2', fullName: 'Dewi Lestari (contoh)', position: 'Analis Kepegawaian', unit: 'KPG', roles: ['STAFF'] },
  { username: 'auditor', fullName: 'Rudi Hartono (contoh)', position: 'Pemeriksa Internal', unit: 'PIM', roles: ['AUDITOR'] },
];

export async function seedDemo(prisma: Db, storage: LocalPrivateStorage, opts: { password?: string; log?: (m: string) => void } = {}) {
  const log = opts.log ?? console.log;
  const units = [
    { code: 'TU', name: 'Subbagian Tata Usaha (contoh)' },
    { code: 'PIM', name: 'Pimpinan (contoh)' },
    { code: 'PRG', name: 'Seksi Program (contoh)' },
    { code: 'KPG', name: 'Seksi Kepegawaian (contoh)' },
  ];
  for (const u of units) await prisma.unit.upsert({ where: { code: u.code }, create: u, update: {} });

  let demoPassword: string | null = null;
  for (const u of DEMO_USERS) {
    if (await prisma.user.findUnique({ where: { username: u.username } })) continue;
    demoPassword ??= opts.password ?? generatePassword();
    const unit = await prisma.unit.findUniqueOrThrow({ where: { code: u.unit } });
    const roles = await prisma.role.findMany({ where: { code: { in: u.roles } } });
    await prisma.user.create({
      data: {
        username: u.username,
        fullName: u.fullName,
        position: u.position,
        unitId: unit.id,
        passwordHash: await hashPassword(demoPassword),
        roles: { create: roles.map((r) => ({ roleId: r.id })) },
      },
    });
    log(`Pengguna contoh dibuat: ${u.username}`);
  }

  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
  for (const type of OUTGOING_TYPES) {
    if (await prisma.documentTemplate.findFirst({ where: { type } })) continue;
    const sample = SAMPLE_TEMPLATES[type];
    const buffer = buildDocx(sample.lines);
    const storageKey = await storage.put(buffer, 'docx');
    await prisma.documentTemplate.create({
      data: {
        type,
        name: sample.name,
        version: 1,
        isSample: true,
        placeholders: defaultPlaceholderDefs(detectPlaceholders(buffer)),
        createdById: admin.id,
        approvedByName: null,
        file: {
          create: {
            kind: 'TEMPLATE',
            storageKey,
            originalName: `${sample.name}.docx`,
            mimeType: MIME_BY_KIND.docx,
            sizeBytes: buffer.length,
            checksumSha256: sha256(buffer),
            uploadedById: admin.id,
          },
        },
      },
    });
    log(`Templat contoh dibuat: ${type}`);
  }
  return { demoPassword };
}

async function main() {
  const prisma = createPrisma();
  try {
    const { adminPassword } = await seedBase(prisma, { adminPassword: env.SEED_ADMIN_PASSWORD });
    let demoPassword: string | null = null;
    if (env.NODE_ENV !== 'production' && env.SEED_DEMO_DATA) {
      ({ demoPassword } = await seedDemo(prisma, new LocalPrivateStorage(env.DOCUMENT_STORAGE_PATH), {
        password: process.env.SEED_DEMO_PASSWORD,
      }));
    }
    console.log('\nSeed selesai.');
    if (adminPassword && !env.SEED_ADMIN_PASSWORD) {
      console.log(`  admin / ${adminPassword}   ← catat sekarang; tidak akan ditampilkan lagi`);
    }
    if (demoPassword && !process.env.SEED_DEMO_PASSWORD) {
      console.log(`  Pengguna contoh (tu, pimpinan, pegawai1, pegawai2, auditor) / ${demoPassword}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
