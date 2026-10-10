# راهنمای توسعه ماژول و افزودن قابلیت‌های جدید (Module Development Guide)

سامانه بر اساس معماری لایه‌ای و ماژولار پیاده‌سازی شده است. برای افزودن یک ماژول جدید، مراحل زیر را طی نمایید:

## ۱. ساختار پوشه ماژول
در مسیر `src/modules/` یک پوشه جدید بسازید (مثلاً `library` برای کتابخانه):
```
src/modules/library/
├── library.service.ts
├── library.controller.ts
└── library.schemas.ts
```

## ۲. اضافه کردن موجودیت به تایپ‌ها
در `src/core/types.ts` اینترفیس جدول را اضافه کنید و آن را در `DatabaseSchema` رجیستر نمایید.

## ۳. تعریف مجوزها و سیاست‌های دسترسی
در `src/modules/rbac/rbac.service.ts` مجوزهای ماژول جدید را به کاتالوگ مجوزها اضافه کنید:
```ts
{
  module: 'library',
  moduleTitleFa: 'کتابخانه دیجیتال',
  permissions: [
    { key: 'library.read', titleFa: 'مشاهده کتاب‌ها' },
    { key: 'library.borrow', titleFa: 'امانت‌دادن کتاب' }
  ]
}
```

## ۴. ثبت ماژول در رجیستری
در `src/modules/modules-registry/modules.service.ts` مانیفست ماژول را ثبت کنید.

## ۵. نوشتن تست‌های خودکار
در مسیر `tests/` یک فایل تست مجزا برای ماژول بسازید و با دستور `npm test` اجرای آن را ارزیابی فرمایید.
