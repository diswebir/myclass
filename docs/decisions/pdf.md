# تصمیم: تولید PDF فارسی (Spike فاز ۰)

تاریخ: 2026-10-10 — نتیجه: **موفق** — راه‌حل: `pdf-lib` + فونت Vazirmatn + شکل‌دهنده سفارشی + `bidi-js`.

## هدف

گواهی/رسید PDF با متن فارسیِ درست (حروف متصل، RTL، اعداد فارسی، متن مختلط) — بدون Puppeteer/Chromium (ممنوع per spec) و بدون وابستگی native (compile در مقصد ممنوع).

## گزینه‌های بررسی‌شده

| گزینه | verdict | دلیل |
|---|---|---|
| pdfmake | ❌ رد شد | وابستگی `linebreak` native (node-gyp) → compile روی هاست اشتراکی خطاپذیر است |
| pdf-lib | ✅ انتخاب شد | ۱۰۰٪ JS خالص؛ embed فونت TTF؛ drawText با codepoint |
| Puppeteer/Chromium | ❌ ممنوع | per spec §۳ |
| HTML/CSS + چاپ مرورگر | ✅ پیاده‌سازی می‌شود (fallback) | مرورگر شکل‌دهی را با GSUB انجام می‌دهد؛ برای قالب‌های پیچیده و چاپ.

## یافته‌های spike

1. **فونت:** Vazirmatn v33.0.3 (OFL) — نسخه TTF از بسته npm `vazirmatn` گرفته شد (مسیر: `public/fonts/`). فونت glyphهای Arabic Presentation Forms-B را در cmap دارد (213/832 — برای حروف فارسی کفایت می‌کند).
2. **شکل‌دهی پیش از رندر (گزینه «الف» spec):** pdf-lib شکل‌دهی (GSUB) ندارد؛ derfor ein Wörterbuch der Form (4-form model: isolated/final/initial/medial + ligature «لا») — با **HarfBuzz** (harfbuzzjs، wasm — فقط ابزار build) تولید و تأیید شد: `src/core/text/persian-forms.json`.
3. **اعتبارسنجی:** شکل‌دهنده runtime (`src/core/text/shape.ts`) با ۲۳/۲۳ نمونه در برابر HarfBuzz (calt خاموش) **تطابق کامل** دارد — `tests/fixtures/shaping-cases.json`.
4. **Bidi:** متن مختلط (فارسی + کد/عدد لاتین) با `bidi-js` (UAX#9) به ترتیب دیداری تبدیل می‌شود.
5. **فونت‌ها (variant):** ۱۶ مورد تفاوت glyph بین HarfBuzz و کد standard (duplicate glyphs در فونت) ثبت شد — رندر معادل است؛ در جدول نهایی از کدِ cmap فونت استفاده شده (renders exact glyph).
6. **ساختار PDF تأیید شد:** ۱ صفحه، FontFile2 (فونت embed/subset)، نام Vazirmatn، content stream با Tj، و cmap فونت embed شده شامل glyphهای کلیدی (FEB3, FEFC, FEDF, FBFF, 06F4, 004D). فایل نمونه: `spike-output/certificate-sample.pdf` (167.9 KB).

## خط لوله نهایی (per PDF)

```
normalize (ارقام/فاصله) → shapeLogical (جدول فرم‌ها) → toVisualOrder (bidi-js, پایه RTL)
→ pdf-lib drawText (رسم چپ‌به‌راست رشته دیداری) + QR (qrcode → PNG → embedPng)
```

## محدودیت‌های ثبت‌شده (honest)

- **harakat** (اعراب) حذف می‌شوند — pdf-lib Positionierung GPOS ندارد.
- **calt variants** فونت (مثلاً یِ «long» قبل از ر) بازتولید نمی‌شوند؛ فرم استاندارد رندر می‌شود (ظاهری معادل).
- **استخراج متن** از PDF (Copy/Paste و ToUnicode) Persian قابل‌خواندن نخواهد بود — اعتبارسنجی از طریق صفحه وب عمومی انجام می‌شود.
- بررسی **visual** نهایی روی هاست/مرورگر کاربر توصیه می‌شود (در sandbox تأیید ساختاری انجام شد).

## تصمیم

- Producción PDF: **pdf-lib + shape.ts** (همین خط لوله) — برای گواهی، رسید پرداخت، خروجی PDF حضور و غیاب.
- Fallback/چاپ: صفحه HTML با فونت self-host + دکمه «چاپ / ذخیره PDF» ( per spec §۳-ب).
- Puppeteer/Chromium و pdfmake استفاده نمی‌شوند.

## فایل‌ها

- `src/core/text/shape.ts` — شکل‌دهنده runtime (prod)
- `src/core/text/persian-forms.json` — جدول فرم‌ها (تولیدشده با HarfBuzz)
- `tests/fixtures/shaping-cases.json` — fixtureهای تأیید
- `scripts/spike-pdf.ts` — اسکریپت spike (harfbuzzjs + fontkit — dev)
- `spike-output/certificate-sample.pdf` — خروجی نمونه
- `public/fonts/Vazirmatn-*.ttf|woff2` — فونت self-host
