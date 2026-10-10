/** سرویس files — آپلود امن: تشخیص نوع واقعی (file-type)، سقف اندازه، نام تصادفی، ضد Path Traversal، ذخیره خارج از webroot، دانلود کنترل‌شده (REQ-X-05). */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Kysely } from 'kysely';
import { fromBuffer as fileTypeFromBuffer } from 'file-type';
import type { Database } from '../../core/db/types';
import type { Config } from '../../core/config/env';
import { AppError } from '../../core/errors/AppError';
import { nowDb } from '../../core/db/time';
import { AuditService } from '../audit/audit.service';

const ALLOWED_MIME_PREFIXES = ['image/', 'application/pdf'];
const ALLOWED_MIME_EXACT = ['text/csv', 'text/plain'];

export class FilesService {
  readonly audit: AuditService;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly config: Config,
  ) {
    this.audit = new AuditService(db);
  }

  private uploadDir(): string {
    const dir = path.isAbsolute(this.config.UPLOAD_DIR)
      ? this.config.UPLOAD_DIR
      : path.join(process.cwd(), this.config.UPLOAD_DIR);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private assertAllowedMime(mime: string): void {
    const ok =
      ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p)) ||
      ALLOWED_MIME_EXACT.includes(mime);
    if (!ok) {
      throw AppError.badRequest(`نوع فایل مجاز نیست: ${mime}. مجاز: تصویر، PDF، CSV.`);
    }
  }

  /** آپلود — بررسی نوع واقعی با file-type (magic bytes)، نه پسوند. */
  async upload(opts: {
    buffer: Buffer;
    originalName: string;
    ownerType: string;
    ownerId: number;
    uploadedBy: number | null;
  }): Promise<{ id: number; mime: string; size: number; storedName: string }> {
    const maxBytes = this.config.MAX_UPLOAD_MB * 1024 * 1024;
    if (opts.buffer.length === 0) throw AppError.badRequest('فایل خالی است.');
    if (opts.buffer.length > maxBytes) {
      throw AppError.badRequest(`حجم فایل بیشتر از سقف ${this.config.MAX_UPLOAD_MB} مگابایت است.`);
    }
    // تشخیص نوع واقعی
    const detected = await fileTypeFromBuffer(opts.buffer);
    let mime: string;
    if (detected) {
      mime = detected.mime;
    } else {
      // برای CSV متنی — file-type آن را نمی‌شناسد — بررسی دستی
      const head = opts.buffer.subarray(0, 512).toString('utf-8');
      if (/^[\x20-\x7E\u0600-\u06FF\r\n,;"]+$/.test(head)) mime = 'text/csv';
      else throw AppError.badRequest('نوع فایل ناشناخته است.');
    }
    this.assertAllowedMime(mime);

    // نام تصادفی — ضد Path Traversal (نام فایل اصلی هرگز ذخیره/استفاده نمی‌شود)
    const ext = detected?.ext ?? (mime === 'text/csv' ? 'csv' : mime === 'application/pdf' ? 'pdf' : 'bin');
    const storedName = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
    const dir = this.uploadDir();
    const storagePath = path.join(dir, storedName);
    // ایمنی: مطمئن — خارج از webroot (UPLOAD_DIR پیش‌فرض ../storage/uploads)
    const resolved = path.resolve(storagePath);
    const resolvedDir = path.resolve(dir);
    if (!resolved.startsWith(resolvedDir + path.sep)) {
      throw AppError.internal('مسیر ذخیره‌سازی نامعتبر است.');
    }
    fs.writeFileSync(resolved, opts.buffer, { mode: 0o600 });

    const res = await this.db
      .insertInto('files')
      .values({
        owner_type: opts.ownerType,
        owner_id: opts.ownerId,
        stored_name: storedName,
        original_name: path.basename(opts.originalName).slice(0, 255),
        mime,
        size: String(opts.buffer.length),
        storage_path: path.relative(process.cwd(), resolved),
        uploaded_by: opts.uploadedBy,
        created_at: nowDb(),
      })
      .executeTakeFirstOrThrow();
    const id = Number(res.insertId);
    await this.audit.log({
      actorId: opts.uploadedBy,
      action: 'file_uploaded',
      module: 'files',
      entityType: 'file',
      entityId: id,
      meta: { ownerType: opts.ownerType, ownerId: opts.ownerId, mime, size: opts.buffer.length },
    });
    return { id, mime, size: opts.buffer.length, storedName };
  }

  /** دانلود — فقط با بررسی مالکیت (توسط policy). */
  async getFileForDownload(fileId: number) {
    const row = await this.db
      .selectFrom('files')
      .selectAll()
      .where('id', '=', fileId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) throw AppError.notFound('فایل یافت نشد.');
    const abs = path.isAbsolute(row.storage_path)
      ? row.storage_path
      : path.join(process.cwd(), row.storage_path);
    const resolved = path.resolve(abs);
    // ضد Path Traversal — مسیر باید داخل UPLOAD_DIR باشد
    const dir = path.resolve(this.uploadDir());
    if (!resolved.startsWith(dir + path.sep)) {
      throw AppError.internal('مسیر فایل نامعتبر است.');
    }
    if (!fs.existsSync(resolved)) throw AppError.notFound('فایل روی دیسک موجود نیست.');
    return {
      ...row,
      buffer: fs.readFileSync(resolved),
      absPath: resolved,
    };
  }

  async softDelete(actorId: number, fileId: number): Promise<void> {
    await this.db.updateTable('files').set({ deleted_at: nowDb() }).where('id', '=', fileId).execute();
    await this.audit.log({
      actorId,
      action: 'file_deleted',
      module: 'files',
      entityType: 'file',
      entityId: fileId,
    });
  }
}
