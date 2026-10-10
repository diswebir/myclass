/**
 * SMS service — patterns, events, variable mapping, DB queue (dedupe + rate limit + backoff),
 * staged processing, admin test-send. (REQ-P6-03, REQ-P6-04)
 * The provider is Fake unless SMS_LIVE_TESTS=1 (REQ-P6-05) — see provider.ts.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../core/db/types';
import type { AuthUser } from '../../core/http/context';
import type { Config } from '../../core/config/env';
import { AppError } from '../../core/errors/AppError';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { decryptSecret } from '../../core/security/crypto';
import { normalizePhone } from '../../core/security/normalize';
import { nowDb } from '../../core/db/time';
import { logger } from '../../core/logger/logger';
import { FakeSmsProvider, getSmsProvider, type SmsProvider } from './provider';

interface PatternVariable {
  name: string;
  required?: boolean;
  default?: string | null;
}

interface EventCondition {
  field: string;
  op: 'gte' | 'lte' | 'eq';
  value: string;
}

export interface EnqueueContext {
  entityType: string;
  entityId: number;
  studentId?: number;
  classId?: number;
  teacherId?: number;
  customPhone?: string;
}

export class SmsService {
  private readonly audit: AuditService;
  private readonly settings: SettingsService;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly config: Config,
  ) {
    this.audit = new AuditService(db);
    this.settings = new SettingsService(db, config);
  }

  // ---------- provider ----------

  /** API key from settings (encrypted at rest) — fallback to env. Never logged. */
  async getApiKey(): Promise<string> {
    const row = await this.db
      .selectFrom('settings')
      .select('value')
      .where('key', '=', 'sms.ip_panel_api_key')
      .executeTakeFirst();
    const stored = row?.value;
    if (stored) {
      try {
        const plain = decryptSecret(stored, this.config.ENCRYPTION_KEY);
        const parsed = JSON.parse(plain) as string;
        if (parsed) return parsed;
      } catch {
        logger.warn('sms: stored api key could not be decrypted — falling back to env');
      }
    }
    return this.config.IP_PANEL_API_KEY ?? '';
  }

  async getProvider(): Promise<SmsProvider> {
    const defs = await this.settings.getMany(['sms.ip_panel_base_url', 'sms.default_sender']);
    const apiKey = await this.getApiKey();
    return getSmsProvider(this.config, {
      apiKey,
      baseUrl: String(defs['sms.ip_panel_base_url'] ?? this.config.IP_PANEL_BASE_URL),
      originator: defs['sms.default_sender'] != null ? String(defs['sms.default_sender']) : null,
    });
  }

  // ---------- seed ----------

  /** Default patterns + events (idempotent — installer runs it after migrate). */
  async seedDefaults(): Promise<void> {
    const patterns: Array<{ name: string; code: string; variables: PatternVariable[] }> = [
      { name: 'خوش‌آمدگویی ثبت‌نام', code: 'welcome_student', variables: [{ name: 'student_name', required: true }] },
      {
        name: 'تأیید پرداخت',
        code: 'payment_approved',
        variables: [
          { name: 'student_name', required: true },
          { name: 'amount', required: true },
          { name: 'class_title', required: false, default: '' },
        ],
      },
      {
        name: 'صدور مدرک',
        code: 'certificate_issued',
        variables: [
          { name: 'student_name', required: true },
          { name: 'class_title', required: false, default: '' },
          { name: 'cert_code', required: true },
        ],
      },
      {
        name: 'یادآوری جلسه کلاس',
        code: 'class_reminder',
        variables: [
          { name: 'class_title', required: true },
          { name: 'session_date', required: true },
          { name: 'student_name', required: false, default: '' },
        ],
      },
    ];
    const patternIds: Record<string, number> = {};
    for (const p of patterns) {
      const existing = await this.db
        .selectFrom('sms_patterns')
        .select('id')
        .where('pattern_code', '=', p.code)
        .executeTakeFirst();
      if (existing) {
        patternIds[p.code] = Number(existing.id);
        continue;
      }
      const res = await this.db
        .insertInto('sms_patterns')
        .values({
          name: p.name,
          pattern_code: p.code,
          provider: 'ippanel',
          variables: JSON.stringify(p.variables),
          is_active: 1,
          created_at: nowDb(),
          updated_at: nowDb(),
        })
        .executeTakeFirstOrThrow();
      patternIds[p.code] = Number(res.insertId);
    }
    const events: Array<{
      key: string;
      name: string;
      patternCode: string;
      recipient: string;
      mapping: Record<string, string>;
      delay: number;
    }> = [
      {
        key: 'enrollment_created',
        name: 'ثبت‌نام جدید',
        patternCode: 'welcome_student',
        recipient: 'student',
        mapping: { student_name: 'student_name' },
        delay: 0,
      },
      {
        key: 'payment_approved',
        name: 'پرداخت تأیید شد',
        patternCode: 'payment_approved',
        recipient: 'student',
        mapping: { student_name: 'student_name', amount: 'amount', class_title: 'class_title' },
        delay: 0,
      },
      {
        key: 'certificate_issued',
        name: 'مدرک صادر شد',
        patternCode: 'certificate_issued',
        recipient: 'student',
        mapping: { student_name: 'student_name', class_title: 'class_title', cert_code: 'cert_code' },
        delay: 0,
      },
      {
        key: 'class_session_reminder',
        name: 'یادآوری جلسه کلاس',
        patternCode: 'class_reminder',
        recipient: 'class_students',
        mapping: { class_title: 'class_title', session_date: 'session_date', student_name: 'student_name' },
        delay: 1440,
      },
    ];
    for (const ev of events) {
      const existing = await this.db.selectFrom('sms_events').select('id').where('event_key', '=', ev.key).executeTakeFirst();
      if (existing) continue;
      await this.db
        .insertInto('sms_events')
        .values({
          event_key: ev.key,
          name: ev.name,
          pattern_id: patternIds[ev.patternCode] ?? null,
          enabled: 1,
          delay_minutes: ev.delay,
          mapping: JSON.stringify(ev.mapping),
          condition: '{}',
          recipient: ev.recipient,
          retry_max: 3,
          retry_backoff_minutes: 5,
          is_active: 1,
          created_at: nowDb(),
          updated_at: nowDb(),
        })
        .execute();
    }
  }

  // ---------- CRUD patterns / events ----------

  async listPatterns() {
    return this.db.selectFrom('sms_patterns').selectAll().orderBy('id').execute();
  }

  async createPattern(actor: AuthUser, input: {
    name: string;
    patternCode: string;
    provider?: string;
    variables?: PatternVariable[];
    isActive?: boolean;
  }) {
    const exists = await this.db
      .selectFrom('sms_patterns')
      .select('id')
      .where('pattern_code', '=', input.patternCode)
      .executeTakeFirst();
    if (exists) throw AppError.conflict('کد پترن تکراری است.');
    const res = await this.db
      .insertInto('sms_patterns')
      .values({
        name: input.name,
        pattern_code: input.patternCode,
        provider: input.provider ?? 'ippanel',
        variables: JSON.stringify(input.variables ?? []),
        is_active: input.isActive === false ? 0 : 1,
        created_at: nowDb(),
        updated_at: nowDb(),
      })
      .executeTakeFirstOrThrow();
    const id = Number(res.insertId);
    await this.audit.log({
      actorId: actor.id,
      action: 'sms_pattern_created',
      module: 'sms',
      entityType: 'sms_pattern',
      entityId: id,
      meta: { patternCode: input.patternCode },
    });
    return id;
  }

  async updatePattern(actor: AuthUser, id: number, patch: Partial<{
    name: string;
    provider: string;
    variables: PatternVariable[];
    isActive: boolean;
  }>) {
    const sets: Record<string, unknown> = { updated_at: nowDb() };
    if (patch.name !== undefined) sets.name = patch.name;
    if (patch.provider !== undefined) sets.provider = patch.provider;
    if (patch.variables !== undefined) sets.variables = JSON.stringify(patch.variables);
    if (patch.isActive !== undefined) sets.is_active = patch.isActive ? 1 : 0;
    const res = await this.db.updateTable('sms_patterns').set(sets).where('id', '=', id).executeTakeFirst();
    if (Number(res.numUpdatedRows) === 0) throw AppError.notFound('پترن یافت نشد.');
    await this.audit.log({
      actorId: actor.id,
      action: 'sms_pattern_updated',
      module: 'sms',
      entityType: 'sms_pattern',
      entityId: id,
      meta: { patch: Object.keys(patch) },
    });
  }

  async listEvents() {
    return this.db
      .selectFrom('sms_events')
      .leftJoin('sms_patterns', 'sms_patterns.id', 'sms_events.pattern_id')
      .select([
        'sms_events.id', 'sms_events.event_key', 'sms_events.name', 'sms_events.pattern_id',
        'sms_events.enabled', 'sms_events.delay_minutes', 'sms_events.mapping', 'sms_events.condition',
        'sms_events.recipient', 'sms_events.retry_max', 'sms_events.retry_backoff_minutes', 'sms_events.is_active',
        'sms_patterns.pattern_code', 'sms_patterns.name as pattern_name',
      ])
      .orderBy('sms_events.id')
      .execute();
  }

  async createEvent(actor: AuthUser, input: {
    eventKey: string;
    name: string;
    patternId?: number | null;
    enabled?: boolean;
    delayMinutes?: number;
    mapping?: Record<string, string>;
    recipient?: string;
    retryMax?: number;
  }) {
    const exists = await this.db.selectFrom('sms_events').select('id').where('event_key', '=', input.eventKey).executeTakeFirst();
    if (exists) throw AppError.conflict('کلید رویداد تکراری است.');
    const res = await this.db
      .insertInto('sms_events')
      .values({
        event_key: input.eventKey,
        name: input.name,
        pattern_id: input.patternId ?? null,
        enabled: input.enabled === false ? 0 : 1,
        delay_minutes: input.delayMinutes ?? 0,
        mapping: JSON.stringify(input.mapping ?? {}),
        condition: '{}',
        recipient: input.recipient ?? 'student',
        retry_max: input.retryMax ?? 3,
        retry_backoff_minutes: 5,
        is_active: 1,
        created_at: nowDb(),
        updated_at: nowDb(),
      })
      .executeTakeFirstOrThrow();
    const id = Number(res.insertId);
    await this.audit.log({
      actorId: actor.id,
      action: 'sms_event_created',
      module: 'sms',
      entityType: 'sms_event',
      entityId: id,
      meta: { eventKey: input.eventKey },
    });
    return id;
  }

  async updateEvent(actor: AuthUser, id: number, patch: Partial<{
    name: string;
    patternId: number | null;
    enabled: boolean;
    delayMinutes: number;
    mapping: Record<string, string>;
    recipient: string;
    retryMax: number;
  }>) {
    const sets: Record<string, unknown> = { updated_at: nowDb() };
    if (patch.name !== undefined) sets.name = patch.name;
    if (patch.patternId !== undefined) sets.pattern_id = patch.patternId;
    if (patch.enabled !== undefined) sets.enabled = patch.enabled ? 1 : 0;
    if (patch.delayMinutes !== undefined) sets.delay_minutes = patch.delayMinutes;
    if (patch.mapping !== undefined) sets.mapping = JSON.stringify(patch.mapping);
    if (patch.recipient !== undefined) sets.recipient = patch.recipient;
    if (patch.retryMax !== undefined) sets.retry_max = patch.retryMax;
    const res = await this.db.updateTable('sms_events').set(sets).where('id', '=', id).executeTakeFirst();
    if (Number(res.numUpdatedRows) === 0) throw AppError.notFound('رویداد یافت نشد.');
    await this.audit.log({
      actorId: actor.id,
      action: 'sms_event_updated',
      module: 'sms',
      entityType: 'sms_event',
      entityId: id,
      meta: { patch: Object.keys(patch) },
    });
  }

  // ---------- variable mapping + condition ----------

  /** Render pattern variables from data — internal->pattern mapping + defaults + required check. */
  renderVariables(
    patternVariables: PatternVariable[],
    mapping: Record<string, string>,
    data: Record<string, unknown>,
  ): { variables: Record<string, string>; missing: string[] } {
    const variables: Record<string, string> = {};
    const missing: string[] = [];
    for (const v of patternVariables) {
      const internalName = Object.keys(mapping).find((k) => mapping[k] === v.name) ?? v.name;
      const raw = data[internalName];
      let value: string | null = raw == null ? null : String(raw);
      if (value == null || value === '') value = v.default ?? null;
      if ((value == null || value === '') && (v.required ?? true)) {
        missing.push(v.name);
        continue;
      }
      variables[v.name] = value ?? '';
    }
    return { variables, missing };
  }

  /** Simple condition: { field, op: gte|lte|eq, value } evaluated against data. */
  checkCondition(condition: EventCondition | null, data: Record<string, unknown>): boolean {
    if (!condition || !condition.field) return true;
    const raw = data[condition.field];
    if (raw == null) return false;
    const a = String(raw);
    const b = String(condition.value);
    if (condition.op === 'eq') return a === b;
    const an = Number(a);
    const bn = Number(b);
    if (Number.isNaN(an) || Number.isNaN(bn)) return false;
    if (condition.op === 'gte') return an >= bn;
    return an <= bn;
  }

  // ---------- recipients ----------

  async recipientsFor(event: { recipient: string }, ctx: EnqueueContext): Promise<string[]> {
    const out: string[] = [];
    const push = (phone: string | null) => {
      const normalized = phone ? normalizePhone(phone) : null;
      if (normalized && !out.includes(normalized)) out.push(normalized);
    };
    if (event.recipient === 'custom') {
      push(ctx.customPhone ?? null);
      return out;
    }
    if (event.recipient === 'student' && ctx.studentId) {
      const row = await this.db.selectFrom('students').select('phone').where('id', '=', ctx.studentId).executeTakeFirst();
      push(row?.phone ?? null);
      return out;
    }
    if (event.recipient === 'teacher' && ctx.teacherId) {
      const row = await this.db.selectFrom('teachers').select('phone').where('id', '=', ctx.teacherId).executeTakeFirst();
      push(row?.phone ?? null);
      return out;
    }
    if (event.recipient === 'class_students' && ctx.classId) {
      const rows = await this.db
        .selectFrom('enrollments')
        .innerJoin('students', 'students.id', 'enrollments.student_id')
        .select('students.phone')
        .where('enrollments.class_id', '=', ctx.classId)
        .where('enrollments.status', '=', 'active')
        .where('students.deleted_at', 'is', null)
        .execute();
      for (const r of rows) push(r.phone);
    }
    return out;
  }

  // ---------- queue ----------

  /**
   * enqueue — dedupe (event+entity+recipient), with delay and rendered variables.
   * best-effort: an error never breaks the main flow (call-site try/catch).
   */
  async enqueue(eventKey: string, ctx: EnqueueContext, data: Record<string, unknown>): Promise<{ queued: number; skipped: string[] }> {
    const skipped: string[] = [];
    const event = await this.db.selectFrom('sms_events').selectAll().where('event_key', '=', eventKey).executeTakeFirst();
    if (!event || !event.enabled || !event.is_active) {
      return { queued: 0, skipped: ['event disabled'] };
    }
    if (!event.pattern_id) {
      return { queued: 0, skipped: ['no pattern'] };
    }
    const pattern = await this.db.selectFrom('sms_patterns').selectAll().where('id', '=', event.pattern_id).executeTakeFirst();
    if (!pattern || !pattern.is_active) {
      return { queued: 0, skipped: ['pattern inactive'] };
    }
    let condition: EventCondition | null = null;
    try {
      const parsed = JSON.parse(event.condition || '{}');
      if (parsed && parsed.field) condition = parsed as EventCondition;
    } catch {
      condition = null;
    }
    if (!this.checkCondition(condition, data)) {
      return { queued: 0, skipped: ['condition not met'] };
    }
    const patternVariables = JSON.parse(pattern.variables || '[]') as PatternVariable[];
    const mapping = JSON.parse(event.mapping || '{}') as Record<string, string>;
    const recipients = await this.recipientsFor(event, ctx);
    if (recipients.length === 0) {
      return { queued: 0, skipped: ['no recipients'] };
    }
    const { variables, missing } = this.renderVariables(patternVariables, mapping, data);
    if (missing.length > 0) {
      return { queued: 0, skipped: [`missing variables: ${missing.join(', ')}`] };
    }
    const delayMs = Number(event.delay_minutes ?? 0) * 60 * 1000;
    const nextAttempt = new Date(Date.now() + delayMs);
    let queued = 0;
    for (const recipient of recipients) {
      const dedupeKey = `${eventKey}:${ctx.entityType}:${ctx.entityId}:${recipient}`;
      const existing = await this.db
        .selectFrom('sms_queue')
        .select('id')
        .where('dedupe_key', '=', dedupeKey)
        .executeTakeFirst();
      if (existing) {
        skipped.push(`duplicate:${recipient}`);
        continue;
      }
      await this.db
        .insertInto('sms_queue')
        .values({
          event_id: Number(event.id),
          recipient,
          variables: JSON.stringify(variables),
          dedupe_key: dedupeKey,
          status: 'pending',
          attempts: 0,
          next_attempt_at: nextAttempt.toISOString(),
          created_at: nowDb(),
          updated_at: nowDb(),
        })
        .execute();
      queued += 1;
    }
    return { queued, skipped };
  }

  /** backoff — base * 2^attempts (minutes), capped at 60. */
  backoffMinutes(baseMinutes: number, attempts: number): number {
    const base = baseMinutes > 0 ? baseMinutes : 5;
    return Math.min(60, base * Math.pow(2, Math.max(0, attempts - 1)));
  }

  /**
   * Staged queue processing — REQ-P6-04: rate limit (default 30/min), backoff, retry_max.
   * Called by cron (dist/jobs/run.js) or the internal endpoint /internal/jobs/run.
   */
  async processPending(opts: { limit?: number } = {}): Promise<{ processed: number; sent: number; failed: number; exhausted: number }> {
    const defs = await this.settings.getMany(['sms.rate_limit_per_minute']);
    const limit = Math.max(1, Math.min(500, opts.limit ?? Number(defs['sms.rate_limit_per_minute'] ?? 30)));
    const provider = await this.getProvider();
    const nowIso = new Date().toISOString();
    const rows = await this.db
      .selectFrom('sms_queue')
      .selectAll()
      .where('status', '=', 'pending')
      .where((eb) => eb.or([eb('next_attempt_at', 'is', null), eb('next_attempt_at', '<=', nowIso)]))
      .orderBy('id')
      .limit(limit)
      .execute();
    let sent = 0;
    let failed = 0;
    let exhausted = 0;
    for (const row of rows) {
      const event = row.event_id
        ? await this.db.selectFrom('sms_events').selectAll().where('id', '=', row.event_id).executeTakeFirst()
        : null;
      const pattern = event?.pattern_id
        ? await this.db.selectFrom('sms_patterns').selectAll().where('id', '=', event.pattern_id).executeTakeFirst()
        : null;
      if (!pattern) {
        await this.db
          .updateTable('sms_queue')
          .set({ status: 'failed', last_error: 'pattern missing', updated_at: nowDb() })
          .where('id', '=', row.id)
          .execute();
        failed += 1;
        continue;
      }
      const variables = JSON.parse(row.variables || '{}') as Record<string, string>;
      const originator = (await this.settings.getMany(['sms.default_sender']))['sms.default_sender'];
      try {
        const result = await provider.sendPattern({
          recipient: row.recipient,
          patternCode: pattern.pattern_code,
          variables,
          originator: originator != null ? String(originator) : null,
          dedupeKey: row.dedupe_key,
        });
        if (result.ok) {
          await this.db
            .updateTable('sms_queue')
            .set({ status: 'sent', sent_at: nowDb(), last_error: null, attempts: Number(row.attempts) + 1, updated_at: nowDb() })
            .where('id', '=', row.id)
            .execute();
          sent += 1;
        } else {
          throw new Error(result.error ?? 'provider error');
        }
      } catch (err) {
        const attempts = Number(row.attempts) + 1;
        const retryMax = Number(event?.retry_max ?? 3);
        const base = Number(event?.retry_backoff_minutes ?? 5);
        const done = attempts >= retryMax;
        const nextAt = done ? null : new Date(Date.now() + this.backoffMinutes(base, attempts) * 60 * 1000).toISOString();
        await this.db
          .updateTable('sms_queue')
          .set({
            status: done ? 'failed' : 'pending',
            attempts,
            next_attempt_at: nextAt,
            last_error: (err as Error).message.slice(0, 500),
            updated_at: nowDb(),
          })
          .where('id', '=', row.id)
          .execute();
        if (done) exhausted += 1;
        else failed += 1;
      }
    }
    return { processed: rows.length, sent, failed, exhausted };
  }

  async listQueue(opts: { status?: string; limit?: number } = {}) {
    let q = this.db
      .selectFrom('sms_queue')
      .leftJoin('sms_events', 'sms_events.id', 'sms_queue.event_id')
      .select([
        'sms_queue.id', 'sms_queue.recipient', 'sms_queue.variables', 'sms_queue.dedupe_key',
        'sms_queue.status', 'sms_queue.attempts', 'sms_queue.next_attempt_at', 'sms_queue.last_error',
        'sms_queue.sent_at', 'sms_queue.created_at', 'sms_events.event_key', 'sms_events.name as event_name',
      ])
      .orderBy('sms_queue.id', 'desc')
      .limit(Math.min(500, opts.limit ?? 100));
    if (opts.status) q = q.where('sms_queue.status', '=', opts.status);
    return q.execute();
  }

  async queueStats() {
    const rows = await this.db
      .selectFrom('sms_queue')
      .select(['status'])
      .select((eb) => eb.fn.countAll().as('c'))
      .groupBy('status')
      .execute();
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = Number(r.c);
    return out;
  }

  // ---------- admin test-send ----------

  async testSend(actor: AuthUser, input: {
    patternId?: number;
    eventKey?: string;
    recipient: string;
    variables?: Record<string, string>;
  }) {
    const normalized = normalizePhone(input.recipient);
    if (!normalized) throw AppError.badRequest('شماره گیرنده معتبر نیست.');
    let patternCode: string | undefined;
    let variables = input.variables ?? {};
    let originator: string | null = null;
    const originatorRow = await this.settings.getMany(['sms.default_sender']);
    originator = originatorRow['sms.default_sender'] != null ? String(originatorRow['sms.default_sender']) : null;
    if (input.patternId) {
      const pattern = await this.db.selectFrom('sms_patterns').selectAll().where('id', '=', input.patternId).executeTakeFirst();
      if (!pattern) throw AppError.notFound('پترن یافت نشد.');
      patternCode = pattern.pattern_code;
      if (Object.keys(variables).length === 0) {
        const defs = JSON.parse(pattern.variables || '[]') as PatternVariable[];
        for (const v of defs) variables[v.name] = v.default ?? `sample-${v.name}`;
      }
    } else if (input.eventKey) {
      const event = await this.db
        .selectFrom('sms_events')
        .leftJoin('sms_patterns', 'sms_patterns.id', 'sms_events.pattern_id')
        .select(['sms_events.mapping', 'sms_patterns.pattern_code', 'sms_patterns.variables'])
        .where('sms_events.event_key', '=', input.eventKey)
        .executeTakeFirst();
      if (!event || !event.pattern_code) throw AppError.notFound('رویداد یا پترن یافت نشد.');
      patternCode = event.pattern_code;
      if (Object.keys(variables).length === 0) {
        const defs = JSON.parse(event.variables || '[]') as PatternVariable[];
        const mapping = JSON.parse(event.mapping || '{}') as Record<string, string>;
        for (const v of defs) {
          const internal = Object.keys(mapping).find((k) => mapping[k] === v.name) ?? v.name;
          variables[v.name] = v.default ?? `sample-${internal}`;
        }
      }
    } else {
      throw AppError.badRequest('patternId یا eventKey الزامی است.');
    }
    const provider = await this.getProvider();
    const result = await provider.sendPattern({
      recipient: normalized,
      patternCode,
      variables,
      originator,
      dedupeKey: `test:${actor.id}:${Date.now()}`,
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'sms_test_sent',
      module: 'sms',
      entityType: 'sms_test',
      entityId: 0,
      meta: { patternCode, recipient: normalized, ok: result.ok, provider: provider.name },
    });
    return { ok: result.ok, provider: provider.name, providerMessageId: result.providerMessageId, error: result.error, variables };
  }
}

/** Best-effort hook — never throws to the call-site. */
export async function tryEnqueue(service: SmsService, eventKey: string, ctx: EnqueueContext, data: Record<string, unknown>): Promise<void> {
  try {
    await service.enqueue(eventKey, ctx, data);
  } catch (err) {
    logger.warn('sms enqueue failed (ignored)', { eventKey, error: (err as Error).message });
  }
}

export { FakeSmsProvider };
