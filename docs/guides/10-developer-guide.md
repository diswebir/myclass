# راهنمای توسعه‌دهنده

این راهنمای توسعه‌دهنده، برای توسعه و پشتیبان‌گیری اپلیکیشن است.

> نکته: معماری سیستم در `docs/architecture.md` و جدول‌های پایگاه داده در `docs/erd.md` را مشاهده کنید.

## گام ۱ — ساختار کلی مخزن

ساختار کلی مخزن در پوشه‌های زیر است:

- `src/` — کد اپلیکیشن و ماژول‌ها.
- `src/core/` — بخش‌های اصلی مثل `db`، `http`، `security` و `log`.
- `src/modules/` — پوشه‌ی هر ماژول (سرویس، روت و view).
- `src/ui/views/` — view ها (Nunjucks).
- `public/` — فایل‌های static و فونت‌ها.
- `migrations/` — migration ها برای پایگاه داده.
- `tests/` — تست‌ها و fixtures.
- `docs/` — راهنمای نصب و ERD.
- `project-control/` — مشخصات پروژه و وضعیت.

## گام ۲ — راه‌اندازی محیط‌ی توسعه

1. ابتدا مخزن را کپی کنید و وارد پوشه‌ی myclass شوید:

```
git clone <repo-url>
cd myclass
```

2. ابتدا بسته‌ها را نصب کنید:

```
npm ci
```

3. از `.env.example` کپی کنید و در `.env` قرار دهید (`DB_DRIVER` برابر `sqlite` یا `mysql`).
4. ابتدا migration ها را اجرا کنید:

```
npm run migrate
```

5. اپلیکیشن را در حالت dev اجرا کنید:

```
npm run dev
```

## گام ۳ — دستورها‌ی مهم

| دستور | توضیح | نکات |
|---|---|---|
| `npm run dev` | اجرای اپلیکیشن در حالت dev (watch) | `tsx` |
| `npm run build` | ساخت `dist/` برای production | `tsc` |
| `npm start` | اجرای اپلیکیشن از `dist/` | `node` |
| `npm run migrate` | اجرای migration از `dist/` | migration پایگاه داده |
| `npm run job:sms` | اجرای job SMS | cron یا دستی |
| `npm test` | اجرای همه‌ی تست‌ها | vitest |
| `npm run typecheck` | بررسی تایپ بدون build | `tsc` |

> نکته: `npm start` به `dist/` نیاز دارد — اگر `dist/` وجود نداشت، `npm run build` را اجرا کنید.

## گام ۴ — الگو‌ی ماژول

هر ماژول در پوشه `src/modules/<name>/`:

- `<name>.service.ts` — منطق کار و ارتباط با پایگاه.
- `<name>.routes.ts` — تعریف روت‌ها (`request` و `response`).
- `<name>.schemas.ts` — تعریف schema و تایپ (validation).
- `index.njk` — view اصلی در `src/ui/views/<name>/` است.
- در `src/modules/registry/registry.ts` ماژول را ثبت کنید.
- مجوزهای ماژول را در `src/modules/rbac/catalog.ts` اضافه کنید.

## گام ۵ — چک‌لیست افزودن ماژول جدید

1. ساخت migration جدید (`migrations/`).
2. تعریف تایپ‌های جدید در `src/core/db/types.ts`.
3. نوشتن سرویس جدید (`<name>.service.ts`).
4. نوشتن روت (`<name>.routes.ts`) — با `requireAuth`، `requirePermission` و CSRF.
5. ساخت view جدید در `src/ui/views/<name>/`.
6. ثبت در `registry.ts` و اضافه کردن مجوز در `catalog.ts`.
7. ثبت لاگ audit در همه‌ی روت‌ها (`AuditService`).
8. نوشتن تست و fixture (`tests/`).

## گام ۶ — الگو‌ی تست

تست‌ها در ۲ بخش است:

- `tests/unit/` — تست‌های واحد (unit).
- `tests/integration/` — تست‌های integration.
- `tests/helpers/` — helpers مشترک برای setup پایگاه داده.

بعد از افزودن تست جدید، تست‌های ماژول را اجرا کنید و نتایج را گزارش دهید.

## گام ۷ — نکات فارسی و RTL

- فونت Vazirmatn در `public/fonts` قرار دارد و از CDN استفاده نمی‌کند.
- صفحه RTL است (متن از راست شروع می‌شود).
- همه‌ی متن‌های فارسی در view ها (Nunjucks) نوشته می‌شود.

## گام ۸ — راهنمای کلی

1. `README.md` را باز کنید.
2. پوشه‌ی `docs/` و `docs/guides/` را بررسی کنید.
3. برای سؤال بیشتر، راهنمای 09 را در `docs/guides/` بررسی کنید.
