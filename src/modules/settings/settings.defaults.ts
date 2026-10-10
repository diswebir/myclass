/** تنظیمات پیش‌فرض — دسته‌بندی + Zod schema per کلید. مقادیر is_secret رمزنگاری می‌شوند. */
import { z } from 'zod';

export interface SettingDef {
  key: string;
  category: string;
  schema: z.ZodTypeAny;
  defaultValue: unknown;
  isSecret: boolean;
  description: string;
}

export const SETTING_DEFS: SettingDef[] = [
  // مؤسسه (A1 — هویت بصری)
  { key: 'institute.name', category: 'institute', schema: z.string().min(1).max(191), defaultValue: 'مؤسسه آموزشی', isSecret: false, description: 'نام مؤسسه' },
  { key: 'institute.logo_file_id', category: 'institute', schema: z.number().int().positive().nullable(), defaultValue: null, isSecret: false, description: 'شناسه فایل لوگو' },
  { key: 'institute.primary_color', category: 'institute', schema: z.string().regex(/^#[0-9a-fA-F]{6}$/), defaultValue: '#1d4ed8', isSecret: false, description: 'رنگ اصلی' },
  { key: 'institute.secondary_color', category: 'institute', schema: z.string().regex(/^#[0-9a-fA-F]{6}$/), defaultValue: '#0f172a', isSecret: false, description: 'رنگ ثانویه' },
  { key: 'institute.address', category: 'institute', schema: z.string().max(500).nullable(), defaultValue: null, isSecret: false, description: 'نشانی' },
  { key: 'institute.phone', category: 'institute', schema: z.string().max(32).nullable(), defaultValue: null, isSecret: false, description: 'تلفن' },
  { key: 'institute.email', category: 'institute', schema: z.string().email().max(191).nullable(), defaultValue: null, isSecret: false, description: 'ایمیل' },
  { key: 'institute.header_note', category: 'institute', schema: z.string().max(500).nullable(), defaultValue: null, isSecret: false, description: 'متن سربرگ (مثلاً در مدارک)' },
  // پول و تقویم
  { key: 'finance.currency_unit', category: 'finance', schema: z.enum(['تومان', 'ریال']), defaultValue: 'تومان', isSecret: false, description: 'واحد پول نمایشی' },
  { key: 'finance.currency_minor_per_major', category: 'finance', schema: z.number().int().positive(), defaultValue: 1, isSecret: false, description: 'تعداد واحد کوچک در واحد بزرگ (تومان=1، ریال=10)' },
  { key: 'ui.calendar', category: 'ui', schema: z.enum(['jalali', 'gregorian']), defaultValue: 'jalali', isSecret: false, description: 'تقویم نمایشی' },
  { key: 'ui.items_per_page', category: 'ui', schema: z.number().int().min(10).max(200), defaultValue: 25, isSecret: false, description: 'تعداد ردیف در صفحه' },
  // حضور و غیاب
  { key: 'attendance.max_absence_warn', category: 'attendance', schema: z.number().int().min(0).max(50), defaultValue: 3, isSecret: false, description: 'حد غیبت برای هشدار' },
  // مدارک
  { key: 'certificates.require_payment_cleared', category: 'certificates', schema: z.boolean(), defaultValue: true, isSecret: false, description: 'صدور مدرک منوط به تسویه مالی' },
  { key: 'certificates.min_attendance_percent', category: 'certificates', schema: z.number().int().min(0).max(100), defaultValue: 70, isSecret: false, description: 'حداقل درصد حضور برای صدور' },
  // پیامک
  { key: 'sms.provider', category: 'sms', schema: z.string().max(64), defaultValue: 'ippanel', isSecret: false, description: 'ارائه‌دهنده پیامک' },
  { key: 'sms.ip_panel_api_key', category: 'sms', schema: z.string().max(255), defaultValue: '', isSecret: true, description: 'کلید API پنل IPPanel (رمزنگاری‌شده، ماسک در UI)' },
  { key: 'sms.ip_panel_base_url', category: 'sms', schema: z.string().url().max(255), defaultValue: 'https://edge.ippanel.com/v1', isSecret: false, description: 'آدرس پایه API' },
  { key: 'sms.default_sender', category: 'sms', schema: z.string().max(64).nullable(), defaultValue: null, isSecret: false, description: 'شماره/نام فرستنده پیش‌فرض' },
  { key: 'sms.rate_limit_per_minute', category: 'sms', schema: z.number().int().min(1).max(500), defaultValue: 30, isSecret: false, description: 'سقف پردازش صف پیامک در دقیقه' },
];

export const SETTING_BY_KEY = new Map(SETTING_DEFS.map((d) => [d.key, d]));
