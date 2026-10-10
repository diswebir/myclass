# ERD — مدل داده myclass

تاریخ: 2026-10-10 — این سند با `migrations/` همگام است. همه جداول `id BIGINT AUTO_INCREMENT PRIMARY KEY` دارند مگر خلافش ذکر شود. تمام تاریخ‌های `DATETIME` به‌صورت UTC ذخیره می‌شوند؛ `DATE` خالص برای تاریخ تقویمی (جلسات). مبالغ `BIGINT` (کوچک‌ترین واحد پول).

## ۱. سیستم و زیرساخت

| جدول | فیلدهای کلیدی | روابط |
|---|---|---|
| `settings` | key (PK, varchar191), category, value (JSON text), is_secret, updated_at, updated_by | — |
| `system_state` | key (PK), value, updated_at | — (شامل install lock) |
| `modules_registry` | slug (PK), name, version, status, manifest (JSON), installed_at, updated_at | — |
| `audit_log` | id, actor_id, action, module, entity_type, entity_id, meta (JSON), ip, created_at | → users |
| `rate_limits` | key (PK), window_start, count, expires_at | — |

## ۲. هویت و دسترسی

| جدول | فیلدهای کلیدی | روابط |
|---|---|---|
| `users` | id, username (UNIQUE), email (UNIQUE NULL), phone (UNIQUE NULL), password_hash, full_name, is_active, must_change_password, failed_login_attempts, locked_until, last_login_at, last_login_ip, created_at, updated_at, deleted_at | — |
| `roles` | id, name, slug (UNIQUE), description, is_system, is_active, created_at, updated_at | — |
| `permissions` | id, module, resource, action, description | UNIQUE(module, resource, action) |
| `role_permissions` | role_id, permission_id | PK(role_id, permission_id) → roles, permissions |
| `user_roles` | user_id, role_id | PK(user_id, role_id) → users, roles |
| `user_sessions` | token_hash (PK), user_id, csrf_token, ip, user_agent, created_at, expires_at, last_seen_at, revoked_at | → users |

## ۳. اشخاص و فایل‌ها

| جدول | فیلدهای کلیدی | روابط |
|---|---|---|
| `files` | id, owner_type, owner_id, stored_name, original_name, mime, size, storage_path, uploaded_by, created_at, deleted_at | — (owner_type+owner_id) |
| `teachers` | id, user_id (UNIQUE NULL), code (UNIQUE), first_name, last_name, phone, email, specialties (JSON), status, started_at (DATE), photo_file_id, notes, created_at, updated_at, deleted_at | → users, files |
| `students` | id, user_id (UNIQUE NULL), code (UNIQUE), first_name, last_name, phone, email, national_id (UNIQUE NULL), guardian_name, guardian_phone, birth_date (DATE), status, joined_at (DATE), notes, created_at, updated_at, deleted_at | → users |

## ۴. آموزشی

| جدول | فیلدهای کلیدی | روابط |
|---|---|---|
| `courses` | id, title, code (UNIQUE), category, level, description, default_fee (BIGINT), duration_hours, is_active, created_at, updated_at, deleted_at | — |
| `classes` | id, course_id, title, code (UNIQUE), description, type, category, level, capacity, fee (BIGINT), start_date, end_date, weekdays (JSON), start_time, end_time, location, status, poster_file_id, prereg_enabled, prereg_deadline, prerequisites, cancellation_policy, created_by, created_at, updated_at, deleted_at | → courses, files, users |
| `class_teachers` | class_id, teacher_id, assigned_at, assigned_by, removed_at | PK(class_id, teacher_id) → classes, teachers, users |
| `class_sessions` | id, class_id, session_date (DATE), start_time, duration_minutes, topic, teacher_id, status, status_note, created_at, updated_at, deleted_at | → classes, teachers |
| `prereg_forms` | id, class_id (UNIQUE), fields (JSON), is_active, created_at, updated_at | → classes |
| `preregistrations` | id, class_id, form_id, tracking_code (UNIQUE), applicant_name, phone, email, field_values (JSON), status, review_note, reviewed_by, reviewed_at, converted_enrollment_id, created_at, updated_at | → classes, prereg_forms, users, enrollments |
| `enrollments` | id, class_id, student_id, status, fee_amount (BIGINT), discount_amount (BIGINT), enrolled_by, enrolled_at, created_at, updated_at | UNIQUE(class_id, student_id) → classes, students, users |

## ۵. حضور و غیاب

| جدول | فیلدهای کلیدی | روابط |
|---|---|---|
| `attendance` | id, session_id, student_id, status, note, marked_by, marked_at, updated_by, updated_at, created_at | UNIQUE(session_id, student_id) → class_sessions, students, users |

## ۶. مالی

| جدول | فیلدهای کلیدی | روابط |
|---|---|---|
| `payment_methods` | id, name, type, is_active, created_at | — |
| `payments` | id, student_id, enrollment_id, method_id, amount (BIGINT), idempotency_key (UNIQUE), status, note, created_by, created_at, approved_by, approved_at, reversed_by, reversed_at, reversal_payment_id | → students, enrollments, payment_methods, users |
| `installments` | id, enrollment_id, amount (BIGINT), due_date (DATE), paid_amount (BIGINT), status, note, created_by, created_at, updated_at | → enrollments, users |
| `ledger_entries` | id, payment_id, student_id, entry_type, amount (BIGINT), balance_after (BIGINT), description, created_by, created_at | append-only → payments, students, users |
| `card_receipts` | id, student_id, enrollment_id, file_id, amount (BIGINT), status, review_note, reviewed_by, reviewed_at, payment_id, idempotency_key (UNIQUE), created_at, updated_at | → students, enrollments, files, payments, users |

## ۷. مدارک

| جدول | فیلدهای کلیدی | روابط |
|---|---|---|
| `certificate_templates` | id, name, design (JSON), file_id, conditions (JSON), is_active, created_at, updated_at | → files |
| `certificates` | id, template_id, student_id, class_id, code (UNIQUE), status, revoke_reason, issued_by, issued_at, file_id, verification_token (UNIQUE), revoked_by, revoked_at, created_at, updated_at | → students, classes, files, users |

## ۸. پیامک

| جدول | فیلدهای کلیدی | روابط |
|---|---|---|
| `sms_patterns` | id, name, pattern_code, provider, variables (JSON), is_active, created_at, updated_at | — |
| `sms_events` | id, event_key (UNIQUE), name, pattern_id, enabled, delay_minutes, mapping (JSON), condition (JSON), recipient, retry_max, retry_backoff_minutes, is_active, created_at, updated_at | → sms_patterns |
| `sms_queue` | id, event_id, recipient, variables (JSON), dedupe_key (UNIQUE), status, attempts, next_attempt_at, last_error, sent_at, created_at, updated_at | → sms_events |

## ۹. اعلان‌ها

| جدول | فیلدهای کلیدی | روابط |
|---|---|---|
| `notifications` | id, user_id, type, title, body, link, read_at, created_at | → users |

## ۱۰. ایندکس‌های کلیدی

- `audit_log(actor_id)`, `audit_log(entity_type, entity_id)`, `audit_log(created_at)`, `audit_log(action)`
- `users(username)`, `users(phone)`, `users(email)`
- `user_sessions(user_id)`
- `teachers(code)`, `teachers(phone)`, `students(code)`, `students(phone)`
- `classes(code)`, `classes(status)`, `classes(course_id)`
- `class_sessions(class_id, session_date)`
- `preregistrations(tracking_code)`, `preregistrations(class_id, status)`, `preregistrations(phone)`
- `enrollments(class_id, student_id)` UNIQUE, `enrollments(student_id)`
- `attendance(session_id, student_id)` UNIQUE, `attendance(student_id)`
- `payments(student_id)`, `payments(enrollment_id)`, `payments(status)`, `payments(idempotency_key)` UNIQUE
- `installments(enrollment_id, due_date)`
- `ledger_entries(student_id, created_at)`, `ledger_entries(payment_id)`
- `card_receipts(status)`, `card_receipts(student_id)`
- `certificates(code)` UNIQUE, `certificates(verification_token)` UNIQUE, `certificates(student_id)`
- `sms_queue(status, next_attempt_at)`, `sms_queue(dedupe_key)` UNIQUE
- `notifications(user_id, read_at)`
