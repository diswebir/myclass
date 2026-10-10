/** سرویس students — پرونده، کد یکتا، سرپرست، ورود گروهی CSV (خطای هر سطر + پیش‌نمایش)، خروجی (REQ-P2-02). */
import type { Kysely } from 'kysely';
import type { Database } from '../../core/db/types';
import { AppError } from '../../core/errors/AppError';
import type { AuthUser } from '../../core/http/context';
import { nowDb } from '../../core/db/time';
import { normalizePhone } from '../../core/security/normalize';
import { parseJalaali } from '../../core/text/jalaali';
import { toDbDate } from '../../core/db/time';
import { AuditService } from '../audit/audit.service';
import { CSV_COLUMNS } from './students.schemas';
import { sanitizeCsvRow } from '../../core/security/csvGuard';

export interface CsvRowResult {
  row: number;
  data: Record<string, string>;
  errors: string[];
}

export class StudentsService {
  readonly audit: AuditService;

  constructor(private readonly db: Kysely<Database>) {
    this.audit = new AuditService(db);
  }

  async list(opts: { q?: string; status?: string; limit?: number; offset?: number } = {}) {
    let q = this.db
      .selectFrom('students')
      .selectAll()
      .where('deleted_at', 'is', null)
      .orderBy('id', 'desc');
    if (opts.q) {
      q = q.where((eb) =>
        eb.or([
          eb('code', 'like', `%${opts.q}%`),
          eb('first_name', 'like', `%${opts.q}%`),
          eb('last_name', 'like', `%${opts.q}%`),
          eb('phone', 'like', `%${opts.q}%`),
        ]),
      );
    }
    if (opts.status) q = q.where('status', '=', opts.status);
    return q.limit(opts.limit ?? 50).offset(opts.offset ?? 0).execute();
  }

  async getById(id: number) {
    const row = await this.db
      .selectFrom('students')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) throw AppError.notFound('فراگیر یافت نشد.');
    return row;
  }

  private normalizeInput(input: {
    code: string;
    firstName: string;
    lastName: string;
    phone: string;
    email?: string;
    nationalId?: string;
    guardianName?: string;
    guardianPhone?: string;
    birthDate?: string;
    notes?: string;
  }) {
    const phone = normalizePhone(input.phone);
    if (!phone) throw AppError.badRequest(`شماره موبایل نامعتبر است: ${input.phone}`);
    const guardianPhone = input.guardianPhone ? normalizePhone(input.guardianPhone) : null;
    if (input.guardianPhone && !guardianPhone) {
      throw AppError.badRequest(`شماره موبایل سرپرست نامعتبر است: ${input.guardianPhone}`);
    }
    let birthDate: string | null = null;
    if (input.birthDate) {
      const d = parseJalaali(input.birthDate);
      if (!d) throw AppError.badRequest(`تاریخ تولد نامعتبر است (شمسی): ${input.birthDate}`);
      birthDate = toDbDate(d);
    }
    return {
      code: input.code.trim(),
      first_name: input.firstName.trim(),
      last_name: input.lastName.trim(),
      phone,
      email: input.email || null,
      national_id: input.nationalId || null,
      guardian_name: input.guardianName || null,
      guardian_phone: guardianPhone,
      birth_date: birthDate,
      notes: input.notes || null,
    };
  }

  async create(actor: AuthUser, input: Parameters<StudentsService['normalizeInput']>[0]) {
    const data = this.normalizeInput(input);
    const exists = await this.db
      .selectFrom('students')
      .select('id')
      .where('code', '=', data.code)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (exists) throw AppError.conflict(`کد فراگیر تکراری است: ${data.code}`);
    const res = await this.db
      .insertInto('students')
      .values({
        ...data,
        status: 'active',
        joined_at: null,
        created_at: nowDb(),
        updated_at: nowDb(),
      })
      .executeTakeFirstOrThrow();
    const id = Number(res.insertId);
    await this.audit.log({
      actorId: actor.id,
      action: 'student_created',
      module: 'students',
      entityType: 'student',
      entityId: id,
      meta: { code: data.code, name: `${data.first_name} ${data.last_name}` },
    });
    return id;
  }

  async update(actor: AuthUser, id: number, input: Partial<Parameters<StudentsService['normalizeInput']>[0]>) {
    await this.getById(id);
    const data = this.normalizeInput({
      code: input.code ?? 'x',
      firstName: input.firstName ?? 'x',
      lastName: input.lastName ?? 'x',
      phone: input.phone ?? '09120000000',
      ...input,
    });
    const set: Record<string, unknown> = { updated_at: nowDb() };
    for (const [k, v] of Object.entries(data)) {
      if (k !== 'code') set[k] = v;
    }
    await this.db.updateTable('students').set(set).where('id', '=', id).execute();
    await this.audit.log({
      actorId: actor.id,
      action: 'student_updated',
      module: 'students',
      entityType: 'student',
      entityId: id,
    });
  }

  async softDelete(actor: AuthUser, id: number) {
    await this.getById(id);
    const active = await this.db
      .selectFrom('enrollments')
      .select('id')
      .where('student_id', '=', id)
      .where('status', '=', 'active')
      .limit(1)
      .executeTakeFirst();
    if (active) {
      throw AppError.conflict('فراگیر در کلاس‌های فعال سبت‌نام دارد؛ ابتدا سبت‌نام‌ها را لغو کنید.');
    }
    await this.db.updateTable('students').set({ deleted_at: nowDb(), status: 'inactive', updated_at: nowDb() }).where('id', '=', id).execute();
    await this.audit.log({
      actorId: actor.id,
      action: 'student_deleted',
      module: 'students',
      entityType: 'student',
      entityId: id,
    });
  }

  // ---------- CSV ----------

  /** پارس و اعتبارسنجی CSV — پیش‌نمایش با خطای هر سطر. */
  parseCsv(csvText: string): { rows: CsvRowResult[]; okCount: number; errorCount: number } {
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      throw AppError.badRequest('فایل CSV باید حداقل یک ردیف header و یک ردیف داده داشته باشد.');
    }
    const header = lines[0].split(',').map((h) => h.trim());
    const colIndex = new Map<string, number>();
    header.forEach((h, i) => colIndex.set(h, i));
    for (const col of CSV_COLUMNS) {
      if (!colIndex.has(col)) {
        throw AppError.badRequest(`ستون '${col}' در CSV موجود نیست. ستون‌های لازم: ${CSV_COLUMNS.join(',')}`);
      }
    }
    const rows: CsvRowResult[] = [];
    let okCount = 0;
    let errorCount = 0;
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(',');
      const data: Record<string, string> = {};
      for (const col of CSV_COLUMNS) {
        data[col] = (cells[colIndex.get(col)!] ?? '').trim();
      }
      const errors: string[] = [];
      if (!data.code) errors.push('کد خالی است');
      if (!data.firstName) errors.push('نام خالی است');
      if (!data.lastName) errors.push('نام خانوادگی خالی است');
      if (!normalizePhone(data.phone)) errors.push(`موبایل نامعتبر: ${data.phone}`);
      if (data.guardianPhone && !normalizePhone(data.guardianPhone)) {
        errors.push(`موبایل سرپرست نامعتبر: ${data.guardianPhone}`);
      }
      if (data.birthDate && !parseJalaali(data.birthDate)) {
        errors.push(`تاریخ تولد نامعتبر (شمسی): ${data.birthDate}`);
      }
      if (errors.length) errorCount++;
      else okCount++;
      rows.push({ row: i + 1, data, errors });
    }
    return { rows, okCount, errorCount };
  }

  /** commit — فقط ردیف‌های معتبر درج می‌شوند؛ تکراری‌ها skip می‌شوند. */
  async importCommit(actor: AuthUser, parsed: { rows: CsvRowResult[] }) {
    let created = 0;
    let skipped = 0;
    const errors: Array<{ row: number; reason: string }> = [];
    for (const r of parsed.rows) {
      if (r.errors.length) {
        skipped++;
        errors.push({ row: r.row, reason: r.errors.join('؛ ') });
        continue;
      }
      try {
        await this.create(actor, r.data as never);
        created++;
      } catch (err) {
        skipped++;
        errors.push({ row: r.row, reason: (err as Error).message });
      }
    }
    await this.audit.log({
      actorId: actor.id,
      action: 'students_imported',
      module: 'students',
      meta: { created, skipped },
    });
    return { created, skipped, errors };
  }

  /** خروجی CSV — با محافظ Formula Injection */
  async exportCsv(): Promise<string> {
    const rows = await this.db
      .selectFrom('students')
      .selectAll()
      .where('deleted_at', 'is', null)
      .orderBy('id')
      .execute();
    const header = CSV_COLUMNS.join(',');
    const lines = rows.map((r) =>
      sanitizeCsvRow([
        r.code,
        r.first_name,
        r.last_name,
        r.phone,
        r.email ?? '',
        r.national_id ?? '',
        r.guardian_name ?? '',
        r.guardian_phone ?? '',
        r.birth_date ?? '',
        r.notes ?? '',
      ]).join(','),
    );
    return [header, ...lines].join('\n');
  }
}
