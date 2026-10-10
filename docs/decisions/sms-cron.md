# تصمیم: اجرای صف پیامک (Cron در cPanel)

تاریخ: 2026-10-10 — per spec §۳: پردازش پس‌زمینه فقط با Cron گرافیکی cPanel قابل اتکا است. **هر دو روش** پیاده‌سازی و مستند می‌شوند.

## روش ۱ — اسکریپت Node (پیشنهادی)

```
* * * * *  cd /home/USER/myclass && /usr/bin/node dist/jobs/run.js >> /dev/null 2>&1
```

- `dist/jobs/run.js` صف `sms_queue` را پردازش می‌کند (staged: batch محدود، backoff، rate limit).
- همچنین: پاکسازی `rate_limits` منقضی و các job دوره‌ای دیگر.
- مزیت: بدون HTTP، بدون توکن، قابل اجرا با هر Cron.
- نکته: مسیر node و پروژه را در دستور cron تنظیم کنید (از cPanel «Cron Jobs» قابل تنظیم).

## روش ۲ — Endpoint داخلی با توکن

```
* * * * *  curl -sS -H "X-Cron-Token: $SMS_CRON_TOKEN" https://example.com/internal/jobs/run > /dev/null
```

- Route: `POST /internal/jobs/run` — فقط با header `X-Cron-Token` (مقدار در env) یا query token.
- Rate limit + عدم افشای جزئیات؛ timeout محدود.
- مناسب وقتی Cron فقط می‌تواند HTTP call کند.

## اگر Cron در دسترس نباشد

- محدودیت مستند می‌شود (per spec §۳): صف در DB می‌ماند؛ «به درخواست‌های تصادفی وب وابسته نمی‌شویم» (per spec) — ارسال فقط از طریق cron انجام می‌شود.

## طراحی

- `src/jobs/run.ts` — entry اسکریپت cron (روش ۱).
- `src/modules/sms/queue.ts` — پردازش صف (staged, backoff, dedupe).
- `src/modules/sms/routes.ts` — شامل `POST /internal/jobs/run` (روش ۲).
- تست: `tests/integration/sms-queue.test.ts` — پردازش صف با Fake Provider (بدون ارسال واقعی).
