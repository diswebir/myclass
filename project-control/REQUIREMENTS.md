# REQUIREMENTS.md — فهرست نیازمندی‌های قابل ردیابی

> منبع: `project-control/MASTER_SPEC.md` (بخش‌های ۰-۹ و پیوست A).
> هر نیازمندی: شناسه یکتا + معیار پذیرش قابل تست + وضعیت.
> وضعیت‌ها: `NOT_STARTED` | `IN_PROGRESS` | `IMPLEMENTED_UNVERIFIED` | `VERIFIED` | `BLOCKED`
> «VERIFIED» فقط وقتی زده می‌شود که معیار پذیرش واقعاً اجرا و موفق شده باشد.

## فاز ۰ — تحلیل و معماری

| ID | نیازمندی | معیار پذیرش | وضعیت |
|---|---|---|---|
| REQ-P0-01 | ذخیره متن کامل spec در `project-control/MASTER_SPEC.md` | فایل موجود و با متن ارسالی یکسان باشد | VERIFIED |
| REQ-P0-02 | همین فایل `REQUIREMENTS.md` با شناسه‌های یکتا و معیار پذیرش | همه نیازمندی‌های spec تحت پوشش شناسه باشند | VERIFIED |
| REQ-P0-03 | فایل `project-control/STATE.md` | موجود و به‌روز باشد | VERIFIED |
| REQ-P0-04 | `PROJECT_STATUS.md` در روت پروژه | موجود و خوانا باشد | VERIFIED |
| REQ-P0-05 | `docs/architecture.md` — معماری ماژولار، جریان داده، استقرار روی cPanel/Passenger | سند موجود؛ ساختار ماژول‌ها و استقرار با کد واقعی منطبق باشد | VERIFIED |
| REQ-P0-06 | `docs/erd.md` — ERD کامل موجودیت‌ها/روابط/کلیدها | سند موجود؛ با migrationهای واقعی منطبق باشد | VERIFIED |
| REQ-P0-07 | `docs/assumptions.md` — پاسخ ۵ سؤال §۴ با فرض محافظه‌کارانه | سند موجود؛ فرض‌ها صریح باشند | VERIFIED |
| REQ-P0-08 | Spike PDF فارسی + `docs/decisions/pdf.md` | PDF نمونه با فونت فارسی embed شده ساخته شود؛ تصمیم سبت شود | VERIFIED |
| REQ-P0-09 | طرح نصب‌کننده + `docs/decisions/installer.md` | جریان نصب، قفل نصب، مسیر جایگزین SQL مستند شود | VERIFIED |
| REQ-P0-10 | `docs/decisions/sms-cron.md` — دو روش اجرای صف پیامک | هر دو روش مستند؛ محدودیت‌ها صریح | VERIFIED |
| REQ-P0-11 | اسکلت پروژه per §۷ (پوشه‌ها، package.json، tsconfig، .env.example) | `npm run build` موفق؛ ساختار با spec منطبق | VERIFIED |
| REQ-P0-12 | سیاست وابستگی‌ها: فقط پکیج‌های JS خالص (prod) | `npm ls --omit=dev` — بدون native addon (better-sqlite3 فقط dev) | VERIFIED |
| REQ-P0-13 | `docs/decisions/testing.md` — استراتژی تست DB در sandbox vs هاست | مستند؛ محدودیت‌ها صریح | VERIFIED |

## فاز ۱ — زیرساخت

| ID | نیازمندی | معیار پذیرش | وضعیت |
|---|---|---|---|
| REQ-P1-01 | ماژول config: env + اعتبارسنجی Zod؛ بدون secret در کد | `npm run typecheck` + تست config | VERIFIED |
| REQ-P1-02 | ماژول db: Kysely + mysql2 (prod) + health ping | تست اتصال (sqlite در sandbox) | VERIFIED |
| REQ-P1-03 | اجرای‌کننده migration نسخه‌بندی‌شده + جدول ردیابی | تست: migrate up/down/re-run idempotent | VERIFIED |
| REQ-P1-04 | migration اولیه: schema کامل (settings, users, roles, permissions, user_roles, user_sessions, audit_log, system_state, modules_registry, rate_limits + موجودیت‌های آموزشی/مالی/پیامک) | تست: جداول/ایندکس‌ها/قیود ساخته شوند | VERIFIED |
| REQ-P1-05 | احراز هویت: login/logout، هش bcryptjs، قفل موقت پس از تلاش ناموفق | تست‌های integration | VERIFIED |
| REQ-P1-06 | نشست: کوکی HttpOnly/Secure/SameSite + جدول DB + خروج از همه نشست‌ها | تست integration | VERIFIED |
| REQ-P1-07 | CSRF synchronizer token (پیاده‌سازی داخلی) | تست: درخواست بدون/با توکن CSRF | VERIFIED |
| REQ-P1-08 | helmet + هدرهای امنیتی + کوکی امن | تست هدرهای پاسخ | VERIFIED |
| REQ-P1-09 | rate limit با ذخیره DB + محدودکننده ورود | تست: بلاک بعد از N تلاش | VERIFIED |
| REQ-P1-10 | RBAC: ۸ نقش سیستمی، مجوز ماژول+منبع+عملیات، نقش سفارشی، بدون خودارتقایی | تست‌های RBAC (مسبت/منفی) | VERIFIED |
| REQ-P1-11 | Policy Layer مرکزی (مجوز + مالکیت/عضویت) | تست‌های IDOR برای منابع | VERIFIED |
| REQ-P1-12 | audit log + middleware + صفحه مشاهده | تست: رویدادها سبت شوند، بدون secret | VERIFIED |
| REQ-P1-13 | ماژول settings: کلید تایپ‌شده + Zod + پیش‌فرض + ماسک + audit | تست‌های integration | VERIFIED |
| REQ-P1-14 | نصب‌کننده وب: compat check → migrate → admin → قفل نصب (فایل خارج public + پرچم DB) — با انتخاب درایور mysql/sqlite | تست سناریوی نصب کامل (sqlite e2e + check graceful mysql) | VERIFIED |
| REQ-P1-15 | صفحه سلامت (فقط مدیر): DB، نسخه Node، وضعیت migration، دیسک، خطاها | تست دسترسی مدیر/غیرمدیر | VERIFIED |
| REQ-P1-16 | Design System RTL + قالب پایه Nunjucks + فونت self-host + htmx/alpine | تست رندر صفحات + بررسی استقرار | VERIFIED |
| REQ-P1-17 | خطاهای فارسی، بدون افشای جزئیات سرور | تست صفحه خطا | VERIFIED |
| REQ-P1-18 | ماژول users: CRUD، فعال/غیرفعال، تغییر/بازنشانی رمز، خروج نشست‌ها | تست‌های integration | VERIFIED |
| REQ-P1-19 | گذر فاز ۱: تست نصب + RBAC + migration — همه موفق | گزارش نتایج | VERIFIED |

## فاز ۲ — اساتید، فراگیران، کلاس‌ها، پیش‌سبت‌نام، سبت‌نام

| ID | نیازمندی | معیار پذیرش | وضعیت |
|---|---|---|---|
| REQ-P2-01 | ماژول teachers: CRUD، کد داخلی، تخصص‌ها، وضعیت، تصویر، چند استاد/کلاس | تست‌های integration | VERIFIED |
| REQ-P2-02 | ماژول students: پرونده، کد یکتا، سرپرست، ورود گروهی CSV (خطای هر سطر + پیش‌نمایش)، خروجی | تست‌های integration + CSV | VERIFIED |
| REQ-P2-03 | ماژول courses/classes: فیلدهای کامل، کد یکتا، ظرفیت، وضعیت‌ها، پوستر، پیش‌نیاز، شرایط انصراف | تست‌های integration | VERIFIED |
| REQ-P2-04 | جلسات: زمان‌بندی، تضاد زمانی استاد/مکان، حفظ سبت‌نام هنگام تغییر برنامه | تست تضاد + integration | VERIFIED |
| REQ-P2-05 | پیش‌سبت‌نام: فرم قابل پیکربندی، کد پیگیری، ضدتکرار، فرم عمومی با rate limit، تأیید/رد/اصلاح | تست‌های integration + عمومی | VERIFIED |
| REQ-P2-06 | تبدیل پیش‌سبت‌نام به سبت‌نام قطعی: بدون کاربر/سبت‌نام تکراری، کنترل ظرفیت | تست تبدیل + تکرار | VERIFIED |
| REQ-P2-07 | جداسازی داده کلاس‌ها + تست negative authorization | تست IDOR | VERIFIED |
| REQ-P2-08 | چند استاد برای هر کلاس؛ تغییر تخصیص بدون از بین‌رفتن تاریخچه | تست reassignment | VERIFIED |

## فاز ۳ — حضور و غیاب + پنل‌ها

| ID | نیازمندی | معیار پذیرش | وضعیت |
|---|---|---|---|
| REQ-P3-01 | حضور و غیاب: جلسه‌محور، ۵ وضعیت، سبت سریع کلاس، یکتایی (فراگیر،جلسه)، اصلاح با audit، گزارش‌ها، درصد، هشدار حد غیبت | تست‌های integration + audit | VERIFIED |
| REQ-P3-02 | پنل استاد: کلاس‌های خود، فهرست فراگیران (فیلدهای مجاز)، سبت حضور، گزارش خود، ویرایش پروفایل؛ بدون دسترسی مالی/تنظیمات | تست‌های دسترسی استاد | VERIFIED |
| REQ-P3-03 | پنل فراگیر: پروفایل، کلاس‌ها، برنامه، حضور خود، مالی خود، آپلود رسید، مدارک، تغییر رمز | تست‌های student-panel | VERIFIED |
| REQ-P3-04 | تست‌های IDOR منفی برای همه منابع | تست‌های authz | VERIFIED |

## فاز ۴ — امور مالی

| ID | نیازمندی | معیار پذیرش | وضعیت |
|---|---|---|---|
| REQ-P4-01 | Money: BIGINT واحد کوچک، parse/normalize/format، بدون FLOAT | تست‌های unit | VERIFIED |
| REQ-P4-02 | پرداخت‌ها، اقساط، مانده/معوق، دفترکل append-only + تراکنش معکوس | تست‌های محاسبه | VERIFIED |
| REQ-P4-03 | رسید کارت‌به‌کارت: آپلود فراگیر، در انتظار بررسی، تأیید/رد با علت، idempotency، ضد دست‌کاری مبلغ | تست‌های integration | VERIFIED |
| REQ-P4-04 | گزارش‌های مالی: رسید پرداخت، بدهکاران، درآمد، اقساط، مالی کلاس‌ها؛ دسترسی مالی جدا | تست‌های integration | VERIFIED |
| REQ-P4-05 | رابط PaymentGateway (آماده درگاه آینده) | typecheck + تست mock | VERIFIED |
| REQ-P4-06 | گذر فاز ۴: تست محاسبات + پرداخت تکراری | گزارش نتایج | VERIFIED |

## فاز ۵ — مدارک

| ID | نیازمندی | معیار پذیرش | وضعیت |
|---|---|---|---|
| REQ-P5-01 | قالب‌های مدرک: بارگذاری/طراحی، شرایط صدور (حضور/مالی طبق تنظیمات) | تست‌های integration | VERIFIED |
| REQ-P5-02 | صدور مدرک: فقط با تحقق شرایط، کد یکتا، PDF per تصمیم spike، صدور گروهی مرحله‌ای | تست‌های صدور | VERIFIED |
| REQ-P5-03 | صفحه عمومی اعتبارسنجی با کد/QR: حداقل اطلاعات + نمایش لغو | تست‌های end-to-end | VERIFIED |
| REQ-P5-04 | لغو مدرک با دلیل + audit + بازتولید فایل بدون تغییر کد | تست‌های لغو | VERIFIED |

## فاز ۶ — پیامک (IPPanel)

| ID | نیازمندی | معیار پذیرش | وضعیت |
|---|---|---|---|
| REQ-P6-01 | رابط SmsProvider + Adapter IPPanel (per مستندات رسمی) + Fake Provider | تست‌های با Fake | NOT_STARTED |
| REQ-P6-02 | کلید API فقط سمت سرور، رمزنگاری‌شده در DB (کلید از env)، ماسک UI، هرگز در لاگ | تست‌های امنیتی | NOT_STARTED |
| REQ-P6-03 | پترن‌ها و رویدادها: فعال/غیرفعال، نگاشت متغیر، منبع استخراج، پیش‌فرض، شرط، مخاطب، تأخیر، retry | تست‌های نگاشت متغیر | NOT_STARTED |
| REQ-P6-04 | صف DB: dedup (رویداد+موجودیت+مخاطب)، rate limit، backoff، پردازش مرحله‌ای، cron `dist/jobs/run.js` + endpoint داخلی با توکن، ارسال آزمایشی | تست‌های صف با Fake | NOT_STARTED |
| REQ-P6-05 | تست‌ها هرگز پیامک واقعی نمی‌فرستند مگر `SMS_LIVE_TESTS=1` | تست gate | NOT_STARTED |

## فاز ۷ — داشبورد، پشتیبان، ماژول‌ها، مستندات، ZIP

| ID | نیازمندی | معیار پذیرش | وضعیت |
|---|---|---|---|
| REQ-P7-01 | داشبورد: KPIهای واقعی از DB، محتوای per نقش، ۷ نمودار Chart.js self-host، فیلتر، خروجی | تست‌های داده واقعی | NOT_STARTED |
| REQ-P7-02 | پشتیبان‌گیری/بازیابی: دامپ DB با Node (بدون mysqldump)، فایل‌های ضروری، فهرست نسخه‌ها، چک سازگاری بازیابی، مجوز ویژه، audit | تست‌های backup/restore | NOT_STARTED |
| REQ-P7-03 | مدیریت ماژول‌ها: manifest، صفحه وضعیت، چک وابستگی هنگام غیرفعال‌سازی، غیرفعال‌سازی مسیرها | تست‌های registry | NOT_STARTED |
| REQ-P7-04 | مستندات فارسی: نصب cPanel، Node.js App، DB، IPPanel، پترن/نگاشت، کاربران/نقش‌ها، backup/restore، به‌روزرسانی، عیب‌یابی | اسناد موجود و کامل | NOT_STARTED |
| REQ-P7-05 | راهنمای توسعه: افزودن قابلیت/ماژول جدید | سند موجود | NOT_STARTED |
| REQ-P7-06 | ZIP نهایی قابل آپلود cPanel + فهرست محتوا + `.env.example` تمیز + SQL dump مستقل | ZIP ساخته و بررسی شود | NOT_STARTED |
| REQ-P7-07 | سناریوی پذیرش §۸ (۲۳ گام) — اجرا و گزارش | گزارش موفق/ناموفق/اجرا‌نشده | NOT_STARTED |

## Cross-cutting (from §۶ و پیوست A)

| ID | نیازمندی | معیار پذیرش | وضعیت |
|---|---|---|---|
| REQ-X-01 | نرمال‌سازی ورودی: ارقام فارسی/عربی، موبایل استاندارد، مبالغ | تست‌های unit | NOT_STARTED |
| REQ-X-02 | تاریخ: ذخیره UTC، تبدیل شمسی در لایه نمایش، تست کبیسه و مرز ماه‌ها | تست‌های unit | NOT_STARTED |
| REQ-X-03 | soft delete + بدون حذف آبشاری ناخواسته + تراکنش در عملیات چندمرحله‌ای | تست‌های integration | NOT_STARTED |
| REQ-X-04 | قیود یکتا و ایندکس‌ها per §۶-ب | تست migration + رفتار | NOT_STARTED |
| REQ-X-05 | فایل‌ها: تشخیص نوع واقعی (file-type)، سقف اندازه، نام تصادفی، ضد Path Traversal، خارج از webroot، دانلود کنترل‌شده | تست‌های آپلود + مخرب | NOT_STARTED |
| REQ-X-06 | CSV: جلوگیری از Formula Injection | تست‌های unit | NOT_STARTED |
| REQ-X-07 | کارایی: صفحه‌بندی سمت سرور، بدون N+1، ایندکس، محدودیت گزارش سنگین، پردازش مرحله‌ای | تست + بازبینی کد | NOT_STARTED |
| REQ-X-08 | UI/UX per A13: RTL، واکنش‌گرا، منوی per مجوز، جدول سمت سرور، فرم با خطای کنار فیلد، حالت خالی، تقویم شمسی، self-host | تست رندر + بازبینی | NOT_STARTED |
| REQ-X-09 | suite امنیتی: CSRF/XSS/SQLi/IDOR/rate-limit + آپلود مخرب | تست‌های امنیتی | NOT_STARTED |
| REQ-X-10 | بدون secret در کد/مخزن/لاگ/پاسخ API | تست scan + بازبینی | NOT_STARTED |
| REQ-X-11 | A1: تنظیمات مؤسسه و هویت بصری (نام، لوگو، رنگ‌ها، سربرگ...) و استفاده در UI/PDF/SMS | تست‌های settings + استفاده | NOT_STARTED |
| REQ-X-12 | اعلان‌های داخل برنامه (notifications) برای پنل‌ها | تست‌های integration | NOT_STARTED |
