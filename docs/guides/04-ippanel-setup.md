# راهنمای پیکربندی ارسال پیامک در IPPanel

این راهنمای پیکربندی IPPanel و ارسال پیامک است.

## گام ۱ — دریافت کلید API

1. وارد پنل [ippanel.com](https://ippanel.com) شوید.
2. بخش **API Keys** را باز کنید و کلید جدید ایجاد کنید.
3. کلید API را کپی کنید.

## گام ۲ — ثبت در تنظیمات

1. از منو `/settings` را باز کنید.
2. `sms.provider` را `ippanel` تنظیم کنید.
3. متغیر `sms.ip_panel_api_key` را ثبت کنید:
   - در پایگاه داده به‌صورت رمزنگاری‌شده ذخیره می‌شود
   - در UI و لاگ هرگز نمایش داده نمی‌شود
4. ذخیره کنید.

> نکته: کلید API در UI و لاگ هرگز نمایش داده نمی‌شود.

## گام ۳ — متغیرهای محیطی (`.env`)

```
SMS_PROVIDER=ippanel
IP_PANEL_API_KEY=کلید API شما
IP_PANEL_BASE_URL=https://edge.ippanel.com/v1
SMS_LIVE_TESTS=0
SMS_CRON_TOKEN=توکن تصادفی ۳۲+ کاراکتری
```

> هشدار: کلید API و توکن‌ها را در محیط نگه ندارید.

## گام ۴ — ارسال واقعی (gateway)

متغیر `SMS_LIVE_TESTS` را کنترل ارسال واقعی می‌کند:

- `0` (پیش‌فرض): ارسال واقعی انجام نمی‌شود — پیامک‌ها به‌صورت Fake ذخیره می‌شوند.
- `1`: ارسال واقعی پیامک انجام می‌شود.

پس از تنظیم `SMS_LIVE_TESTS=1`:

1. از تنظیمات، `sms.provider` = `ippanel` تأیید کنید.
2. از `/sms/test` یک پیامک تست ارسال کنید.

## گام ۵ — Cron Jobs

برای پردازش صف پیامک، هر ۱ دقیقه یک cron نیاز است:

```
* * * * * curl -s -X POST https://example.com/internal/jobs/run -H "Authorization: Bearer $SMS_CRON_TOKEN"
```

یا:

```
* * * * * cd /home/USER/myclass && node dist/jobs/run.js
```

> نکته‌ی: cron را در cPanel (Cron Jobs) اجرا کنید.

## گام ۶ — ارسال تست

1. از صفحه‌ی `/sms/test` ارسال تست کنید.
2. نتیجه را بررسی کنید.
3. از `/sms/queue` صف پیامک را نمایش کنید.

برای رفع خطا، `09-troubleshooting.md` را باز کنید.
