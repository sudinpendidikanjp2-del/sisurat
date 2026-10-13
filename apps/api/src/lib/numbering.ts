import { renderNumberFormat } from '@sisurat/shared';
import type { DbOrTx } from '../db';

/** Atomically increments and returns the next value of a yearly sequence. Call inside a transaction. */
export async function nextSequence(db: DbOrTx, key: string, year: number): Promise<number> {
  const rows = await db.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "NumberSequence" ("key", "year", "lastValue") VALUES (${key}, ${year}, 1)
    ON CONFLICT ("key", "year") DO UPDATE SET "lastValue" = "NumberSequence"."lastValue" + 1
    RETURNING "lastValue"`;
  return Number(rows[0].lastValue);
}

export async function allocateNumber(
  db: DbOrTx,
  params: { key: string; format: string; date?: Date; code?: string },
) {
  const date = params.date ?? new Date();
  const year = date.getFullYear();
  const seq = await nextSequence(db, params.key, year);
  return { seq, year, number: renderNumberFormat(params.format, { seq, date, code: params.code }) };
}
