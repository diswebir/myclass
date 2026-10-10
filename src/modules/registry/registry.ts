/**
 * Modules registry — manifest ماژول‌های داخلی + وضعیت فعال/غیرفعال در جدول modules_registry.
 * غیرفعال‌سازی مسیرها: گیت per-request در server.ts (cachepassen ۵ ثانیه). (REQ-P7-03)
 */
import type { Kysely } from 'kysely';
import type { NextFunction, Request, Response } from 'express';
import type { Database } from '../../core/db/types';
import type { AuthUser } from '../../core/http/context';
import { AppError } from '../../core/errors/AppError';
import { AuditService } from '../audit/audit.service';
import { nowDb } from '../../core/db/time';

export interface ModuleManifest {
  slug: string;
  name: string;
  version: string;
  /** مسیرهای mount (ممکن است چندتا باشد) */
  mountPaths: string[];
  /** مجوز لازم برای مشاهده/استفاده */
  permission: string;
  /** slug ماژول‌هایی که این ماژول به آن‌ها وابسته است */
  dependsOn: string[];
  /** Core module — cannot be disabled (otherwise admin gets locked out). */
  core: boolean;
}

export const MANIFESTS: ModuleManifest[] = [
  { slug: 'users', name: 'کاربران و نقش‌ها', version: '1.0.0', mountPaths: ['/users'], permission: 'users.*', dependsOn: [], core: false },
  { slug: 'rbac', name: 'نقش‌ها و مجوزها', version: '1.0.0', mountPaths: ['/rbac'], permission: 'rbac.*', dependsOn: ['users'], core: false },
  { slug: 'settings', name: 'تنظیمات', version: '1.0.0', mountPaths: ['/settings'], permission: 'settings.*', dependsOn: [], core: false },
  { slug: 'audit', name: 'گزارش ممیزی', version: '1.0.0', mountPaths: ['/audit'], permission: 'audit.view', dependsOn: [], core: false },
  { slug: 'teachers', name: 'اساتید', version: '1.0.0', mountPaths: ['/teachers'], permission: 'teachers.*', dependsOn: ['users'], core: false },
  { slug: 'students', name: 'فراگیران', version: '1.0.0', mountPaths: ['/students'], permission: 'students.*', dependsOn: ['users'], core: false },
  { slug: 'courses', name: 'دوره‌ها', version: '1.0.0', mountPaths: ['/courses'], permission: 'courses.*', dependsOn: [], core: false },
  { slug: 'classes', name: 'کلاس‌ها و جلسات', version: '1.0.0', mountPaths: ['/classes'], permission: 'classes.*', dependsOn: ['courses', 'teachers'], core: false },
  { slug: 'prereg', name: 'پیش‌ثبت‌نام عمومی', version: '1.0.0', mountPaths: ['/prereg'], permission: 'prereg.*', dependsOn: ['classes'], core: false },
  { slug: 'enrollments', name: 'ثبت‌نام', version: '1.0.0', mountPaths: ['/enrollments'], permission: 'enrollment.*', dependsOn: ['classes', 'students'], core: false },
  { slug: 'attendance', name: 'حضور و غیاب', version: '1.0.0', mountPaths: ['/attendance'], permission: 'attendance.*', dependsOn: ['classes', 'enrollments'], core: false },
  { slug: 'files', name: 'فایل‌ها', version: '1.0.0', mountPaths: ['/files'], permission: 'files.*', dependsOn: [], core: false },
  { slug: 'finance', name: 'امور مالی', version: '1.0.0', mountPaths: ['/finance'], permission: 'finance.*', dependsOn: ['enrollments', 'students'], core: false },
  { slug: 'certificates', name: 'مدارک', version: '1.0.0', mountPaths: ['/certificates'], permission: 'certificates.*', dependsOn: ['enrollments', 'attendance', 'finance'], core: false },
  { slug: 'sms', name: 'پیامک‌ها', version: '1.0.0', mountPaths: ['/sms'], permission: 'sms.*', dependsOn: ['settings'], core: false },
  { slug: 'panels', name: 'پنل استاد و فراگیر', version: '1.0.0', mountPaths: ['/panel/teacher', '/panel/student'], permission: 'self.profile.view', dependsOn: ['enrollments'], core: false },
  { slug: 'dashboard', name: 'داشبورد', version: '1.0.0', mountPaths: ['/dashboard'], permission: 'dashboard.view', dependsOn: [], core: false },
  { slug: 'backup', name: 'پشتیبان‌گیری', version: '1.0.0', mountPaths: ['/admin/backup'], permission: 'backup.*', dependsOn: [], core: false },
  { slug: 'modules', name: 'مدیریت ماژول‌ها', version: '1.0.0', mountPaths: ['/admin/modules'], permission: 'modules.*', dependsOn: [], core: true },
];

const manifestBySlug = new Map(MANIFESTS.map((m) => [m.slug, m]));

/** نمونه مشترک — گیت مسیر (server) و صفحه مدیریت (routes) باید یک cache داشته باشند. */
const sharedInstances = new WeakMap<Kysely<Database>, RegistryService>();
export function sharedRegistry(db: Kysely<Database>): RegistryService {
  let inst = sharedInstances.get(db);
  if (!inst) {
    inst = new RegistryService(db);
    sharedInstances.set(db, inst);
  }
  return inst;
}

interface RegistryRow {
  slug: string;
  name: string;
  version: string;
  status: string;
  manifest: string;
  installed_at: string;
  updated_at: string;
}

export class RegistryService {
  private readonly audit: AuditService;
  private cache: { at: number; enabled: Map<string, boolean> } | null = null;

  constructor(private readonly db: Kysely<Database>) {
    this.audit = new AuditService(db);
  }

  /** همگام‌سازی manifestها با جدول (idempotent — installer + تست). */
  async syncManifests(): Promise<void> {
    for (const m of MANIFESTS) {
      const existing = await this.db
        .selectFrom('modules_registry')
        .select('slug')
        .where('slug', '=', m.slug)
        .executeTakeFirst();
      const manifestJson = JSON.stringify({
        mountPaths: m.mountPaths,
        permission: m.permission,
        dependsOn: m.dependsOn,
        core: m.core,
      });
      if (existing) {
        await this.db
          .updateTable('modules_registry')
          .set({ name: m.name, version: m.version, manifest: manifestJson, updated_at: nowDb() })
          .where('slug', '=', m.slug)
          .execute();
      } else {
        await this.db
          .insertInto('modules_registry')
          .values({
            slug: m.slug,
            name: m.name,
            version: m.version,
            status: 'enabled',
            manifest: manifestJson,
            installed_at: nowDb(),
            updated_at: nowDb(),
          })
          .execute();
      }
    }
    this.cache = null;
  }

  async list(): Promise<Array<RegistryRow & { manifestData: Record<string, unknown>; core: boolean }>> {
    const rows = await this.db.selectFrom('modules_registry').selectAll().execute();
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    const out = [];
    for (const m of MANIFESTS) {
      const row = bySlug.get(m.slug);
      let manifestData: Record<string, unknown> = {};
      try {
        manifestData = JSON.parse(row?.manifest ?? '{}') as Record<string, unknown>;
      } catch {
        manifestData = {};
      }
      out.push({
        slug: m.slug,
        name: row?.name ?? m.name,
        version: row?.version ?? m.version,
        status: row?.status ?? 'enabled',
        manifest: row?.manifest ?? '{}',
        installed_at: row?.installed_at ?? '',
        updated_at: row?.updated_at ?? '',
        manifestData,
        core: m.core,
      });
    }
    return out;
  }

  /** وضعیت فعال — با cache ۵ ثانیه‌ای. */
  async isEnabled(slug: string): Promise<boolean> {
    if (!manifestBySlug.has(slug)) return true; // ناشناخته → bPermissive (module ottenere)
    const now = Date.now();
    if (!this.cache || now - this.cache.at > 5000) {
      const rows = await this.db.selectFrom('modules_registry').select(['slug', 'status']).execute();
      const map = new Map(rows.map((r) => [r.slug, r.status === 'enabled']));
      this.cache = { at: now, enabled: map };
    }
    return this.cache.enabled.get(slug) ?? true;
  }

  async setEnabled(actor: AuthUser, slug: string, enabled: boolean): Promise<void> {
    const manifest = manifestBySlug.get(slug);
    if (!manifest) throw AppError.notFound('ماژول یافت نشد.');
    if (!enabled && manifest.core) {
      throw AppError.badRequest('این ماژول هسته است و قابل غیرفعال‌سازی نیست.');
    }
    if (!enabled) {
      const rows = await this.list();
      const dependents = rows.filter((r) => {
        const deps = (r.manifestData.dependsOn as string[] | undefined) ?? [];
        return r.slug !== slug && r.status === 'enabled' && deps.includes(slug);
      });
      if (dependents.length > 0) {
        throw AppError.conflict(`ابتدا ماژول‌های وابسته غیرفعال شوند: ${dependents.map((d) => d.name).join('، ')}`);
      }
    }
    const res = await this.db
      .updateTable('modules_registry')
      .set({ status: enabled ? 'enabled' : 'disabled', updated_at: nowDb() })
      .where('slug', '=', slug)
      .executeTakeFirst();
    if (Number(res.numUpdatedRows) === 0) {
      // سطر وجود ندارد — درج با وضعیت جدید
      await this.db
        .insertInto('modules_registry')
        .values({
          slug: manifest.slug,
          name: manifest.name,
          version: manifest.version,
          status: enabled ? 'enabled' : 'disabled',
          manifest: JSON.stringify({ mountPaths: manifest.mountPaths, permission: manifest.permission, dependsOn: manifest.dependsOn, core: manifest.core }),
          installed_at: nowDb(),
          updated_at: nowDb(),
        })
        .execute();
    }
    this.cache = null;
    await this.audit.log({
      actorId: actor.id,
      action: enabled ? 'module_enabled' : 'module_disabled',
      module: 'modules',
      entityType: 'module',
      entityId: 0,
      meta: { slug, enabled },
    });
  }

  /** گیت مسیر — اگر ماژول غیرفعال باشد، به 404 می‌رود (fall-through). */
  gate(slug: string) {
    const service = this;
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (await service.isEnabled(slug)) {
          next();
          return;
        }
        // next('route') در app.use کار نمی‌کند — مستقیم ۴۰۴ می‌دهیم
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'یافت نشد.' } });
      } catch {
        next();
      }
    };
  }
}
