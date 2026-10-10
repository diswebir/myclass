# راهنمای افزودن الگو پیامک و نگاشت متغیر

این راهنمای افزودن الگو‌ی پیامک در IPPanel و نگاشت متغیر است.

## گام ۱ — ساخت الگو در IPPanel

1. وارد پنل [ippanel.com](https://ippanel.com) شوید.
2. بخش **Patterns** (الگوها) را باز کنید و یک الگو ایجاد کنید.
3. کد الگو (patternCode) را از IPPanel کپی کنید.
4. متغیرهای الگو (مثال برای **ثبت‌نام**):
   - `student_name` — نام دانش‌آموز
   - `amount` — مبلغ
   - `class_title` — عنوان کلاس
   - `code` — کد مدرک (تأیید)

## گام ۲ — افزودن الگو (`/sms/patterns`)

1. `/sms/patterns` را باز کنید.
2. این موارد را وارد کنید:
   - **name**: نام الگو
   - **patternCode**: کد (IPPanel)
   - **variables**: متغیرها (`student_name`)
3. ذخیره کنید.

## گام ۳ — نگاشت رویداد به الگو (`/sms/events`)

در `/sms/events`، برای هر رویداد یک الگو انتخاب کنید:

| رویداد | عنوان | متغیرهای |
|---|---|---|
| `enrollment_created` | ایجاد ثبت‌نام | `student_name`, `class_title` |
| `payment_approved` | تأیید پرداخت | `student_name`, `amount`, `class_title` |
| `certificate_issued` | ثبت مدرک | `student_name`, `class_title`, `code` |
| `class_reminder` | یادآوری کلاس | `student_name`, `class_title` |

## گام ۴ — ارسال از داده واقعی

1. با ایجاد (`/enrollments`، `/finance/payments`، `/certificates/issue`)، پیامک به صف اضافه می‌شود.
2. از `/sms/queue` مشاهده کنید.
3. cron (`/internal/jobs/run`) پیامک‌ها را ارسال می‌کند.
4. نتیجه ارسال را مشاهده کنید.

## گام ۵ — تست ارسال

1. `/sms/test` را باز کنید.
2. گیرنده‌ها را انتخاب کنید و ارسال تست کنید.
3. `/sms/queue` را باز کنید و نتیجه را مشاهده کنید.

> نکته: ارسال تست واقعی فقط با `SMS_LIVE_TESTS=1` انجام می‌شود.

برای اطلاعات بیشتر `04-ippanel-setup.md` را باز کنید.
