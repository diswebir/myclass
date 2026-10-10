# نمودار ارتباط موجودیت‌ها و مدل داده‌ها (Entity-Relationship Model)

پایگاه داده برای تضمین یکپارچگی داده‌ها، امنیت، سرعت و سازگاری با MySQL/MariaDB در cPanel به صورت نرمال‌سازی شده و استاندارد طراحی شده است.

## ۱. جدول‌های اصلی و روابط

### ۱.۱ کاربران، نقش‌ها و احراز هویت
- **`roles`**:
  - `id`: INT AUTO_INCREMENT PRIMARY KEY
  - `name`: VARCHAR(50) UNIQUE (مانند `super_admin`, `teacher`, `student`, `finance_staff`)
  - `title_fa`: VARCHAR(100) (عنوان نمایشی فارسی)
  - `is_system`: BOOLEAN DEFAULT FALSE (نقش‌های سیستمی غیرقابل حذف)
  - `permissions_json`: JSON / TEXT (آرایه مجوزهای ماژولار: `["courses.read", "courses.write", ...]`)
  - `created_at`, `updated_at`: DATETIME

- **`users`**:
  - `id`: INT AUTO_INCREMENT PRIMARY KEY
  - `full_name`: VARCHAR(150) NOT NULL
  - `mobile`: VARCHAR(20) UNIQUE NOT NULL (نرمال‌سازی شده 09xxxxxxxxx)
  - `email`: VARCHAR(150) UNIQUE NULL
  - `password_hash`: VARCHAR(255) NOT NULL (bcryptjs)
  - `role_id`: INT NOT NULL REFERENCES `roles(id)`
  - `status`: ENUM('active', 'inactive', 'suspended') DEFAULT 'active'
  - `avatar_path`: VARCHAR(255) NULL
  - `must_change_password`: BOOLEAN DEFAULT FALSE
  - `created_at`, `updated_at`: DATETIME
  - `deleted_at`: DATETIME NULL (حذف نرم)

- **`sessions`**:
  - `id`: VARCHAR(128) PRIMARY KEY
  - `user_id`: INT NOT NULL REFERENCES `users(id)` ON DELETE CASCADE
  - `ip_address`: VARCHAR(45) NOT NULL
  - `user_agent`: VARCHAR(255) NOT NULL
  - `expires_at`: DATETIME NOT NULL
  - `created_at`: DATETIME NOT NULL

- **`audit_logs`**:
  - `id`: BIGINT AUTO_INCREMENT PRIMARY KEY
  - `user_id`: INT NULL REFERENCES `users(id)` ON DELETE SET NULL
  - `action`: VARCHAR(100) NOT NULL
  - `entity_type`: VARCHAR(50) NOT NULL
  - `entity_id`: VARCHAR(50) NOT NULL
  - `old_values_json`: JSON / TEXT NULL
  - `new_values_json`: JSON / TEXT NULL
  - `ip_address`: VARCHAR(45) NOT NULL
  - `created_at`: DATETIME NOT NULL

### ۱.۲ پرونده اساتید و فراگیران
- **`teachers`**:
  - `id`: INT AUTO_INCREMENT PRIMARY KEY
  - `user_id`: INT UNIQUE NOT NULL REFERENCES `users(id)` ON DELETE CASCADE
  - `internal_code`: VARCHAR(50) UNIQUE NOT NULL
  - `specialties`: TEXT NULL
  - `bio`: TEXT NULL
  - `contract_status`: ENUM('active', 'on_leave', 'terminated') DEFAULT 'active'
  - `contract_start_date`: DATE NULL
  - `management_notes`: TEXT NULL (فقط مدیران)
  - `created_at`, `updated_at`: DATETIME

- **`students`**:
  - `id`: INT AUTO_INCREMENT PRIMARY KEY
  - `user_id`: INT UNIQUE NOT NULL REFERENCES `users(id)` ON DELETE CASCADE
  - `student_code`: VARCHAR(50) UNIQUE NOT NULL
  - `national_id`: VARCHAR(20) NULL
  - `emergency_contact`: VARCHAR(50) NULL
  - `parent_name`: VARCHAR(150) NULL
  - `parent_phone`: VARCHAR(20) NULL
  - `address`: TEXT NULL
  - `internal_notes`: TEXT NULL (فقط دسترسی مجاز)
  - `created_at`, `updated_at`: DATETIME
  - `deleted_at`: DATETIME NULL

### ۱.۳ دوره‌ها، کلاس‌ها، اساتید کلاس و جلسات
- **`courses`**:
  - `id`: INT AUTO_INCREMENT PRIMARY KEY
  - `title`: VARCHAR(150) NOT NULL
  - `code`: VARCHAR(50) UNIQUE NOT NULL
  - `category`: VARCHAR(100) NOT NULL
  - `level`: VARCHAR(50) NOT NULL
  - `description`: TEXT NULL
  - `created_at`, `updated_at`: DATETIME
  - `deleted_at`: DATETIME NULL

- **`classes`**:
  - `id`: INT AUTO_INCREMENT PRIMARY KEY
  - `course_id`: INT NOT NULL REFERENCES `courses(id)` ON DELETE RESTRICT
  - `title`: VARCHAR(150) NOT NULL
  - `code`: VARCHAR(50) UNIQUE NOT NULL
  - `capacity`: INT NOT NULL
  - `tuition_fee`: BIGINT NOT NULL (عدد صحیح بزرگ بدون اعشار)
  - `start_date`: DATE NOT NULL
  - `end_date`: DATE NOT NULL
  - `schedule_days`: VARCHAR(100) NOT NULL (مانند شنبه، دوشنبه)
  - `start_time`: TIME NOT NULL
  - `end_time`: TIME NOT NULL
  - `location`: VARCHAR(150) NOT NULL
  - `status`: ENUM('draft', 'open_for_prereg', 'enrolling', 'capacity_full', 'in_progress', 'completed', 'cancelled') DEFAULT 'draft'
  - `poster_path`: VARCHAR(255) NULL
  - `prereg_enabled`: BOOLEAN DEFAULT FALSE
  - `prereg_fields_json`: JSON / TEXT NULL
  - `min_attendance_percent`: INT DEFAULT 70
  - `created_at`, `updated_at`: DATETIME
  - `deleted_at`: DATETIME NULL

- **`class_teachers`**:
  - `id`: INT AUTO_INCREMENT PRIMARY KEY
  - `class_id`: INT NOT NULL REFERENCES `classes(id)` ON DELETE CASCADE
  - `teacher_id`: INT NOT NULL REFERENCES `teachers(id)` ON DELETE RESTRICT
  - `role_in_class`: VARCHAR(50) DEFAULT 'primary'
  - `created_at`: DATETIME NOT NULL
  - UNIQUE(`class_id`, `teacher_id`)

- **`class_sessions`**:
  - `id`: INT AUTO_INCREMENT PRIMARY KEY
  - `class_id`: INT NOT NULL REFERENCES `classes(id)` ON DELETE CASCADE
  - `session_number`: INT NOT NULL
  - `session_date`: DATE NOT NULL
  - `start_time`: TIME NOT NULL
  - `end_time`: TIME NOT NULL
  - `topic`: VARCHAR(255) NULL
  - `teacher_id`: INT NULL REFERENCES `teachers(id)` ON DELETE SET NULL
  - `status`: ENUM('scheduled', 'held', 'cancelled', 'rescheduled') DEFAULT 'scheduled'
  - `notes`: TEXT NULL
  - `created_at`, `updated_at`: DATETIME

### ۱.۴ پیش‌ثبت‌نام، ثبت‌نام قطعی و حضور و غیاب
- **`preregistrations`**:
  - `id`: INT AUTO_INCREMENT PRIMARY KEY
  - `class_id`: INT NOT NULL REFERENCES `classes(id)` ON DELETE RESTRICT
  - `tracking_code`: VARCHAR(50) UNIQUE NOT NULL
  - `full_name`: VARCHAR(150) NOT NULL
  - `mobile`: VARCHAR(20) NOT NULL
  - `email`: VARCHAR(150) NULL
  - `extra_data_json`: JSON / TEXT NULL
  - `attachment_path`: VARCHAR(255) NULL
  - `status`: ENUM('pending', 'approved', 'rejected', 'needs_correction') DEFAULT 'pending'
  - `reject_reason`: TEXT NULL
  - `created_at`, `updated_at`: DATETIME

- **`enrollments`**:
  - `id`: INT AUTO_INCREMENT PRIMARY KEY
  - `student_id`: INT NOT NULL REFERENCES `students(id)` ON DELETE RESTRICT
  - `class_id`: INT NOT NULL REFERENCES `classes(id)` ON DELETE RESTRICT
  - `preregistration_id`: INT NULL REFERENCES `preregistrations(id)` ON DELETE SET NULL
  - `status`: ENUM('active', 'completed', 'cancelled', 'dropped') DEFAULT 'active'
  - `tuition_agreed`: BIGINT NOT NULL
  - `notes`: TEXT NULL
  - `created_at`, `updated_at`: DATETIME
  - UNIQUE(`student_id`, `class_id`)

- **`attendance_records`**:
  - `id`: BIGINT AUTO_INCREMENT PRIMARY KEY
  - `session_id`: INT NOT NULL REFERENCES `class_sessions(id)` ON DELETE CASCADE
  - `student_id`: INT NOT NULL REFERENCES `students(id)` ON DELETE RESTRICT
  - `status`: ENUM('present', 'absent', 'late', 'excused', 'unrecorded') DEFAULT 'unrecorded'
  - `note`: VARCHAR(255) NULL
  - `recorded_by_user_id`: INT NOT NULL REFERENCES `users(id)`
  - `created_at`, `updated_at`: DATETIME
  - UNIQUE(`session_id`, `student_id`)

### ۱.۵ امور مالی، اقساط و فیش‌های پرداختی
- **`installments`**:
  - `id`: INT AUTO_INCREMENT PRIMARY KEY
  - `enrollment_id`: INT NOT NULL REFERENCES `enrollments(id)` ON DELETE CASCADE
  - `installment_number`: INT NOT NULL
  - `amount`: BIGINT NOT NULL
  - `due_date`: DATE NOT NULL
  - `status`: ENUM('pending', 'paid', 'overdue', 'partially_paid') DEFAULT 'pending'
  - `paid_amount`: BIGINT DEFAULT 0
  - `notes`: VARCHAR(255) NULL
  - `created_at`, `updated_at`: DATETIME

- **`payments`**:
  - `id`: BIGINT AUTO_INCREMENT PRIMARY KEY
  - `enrollment_id`: INT NOT NULL REFERENCES `enrollments(id)` ON DELETE RESTRICT
  - `installment_id`: INT NULL REFERENCES `installments(id)` ON DELETE SET NULL
  - `amount`: BIGINT NOT NULL
  - `payment_method`: ENUM('cash', 'card_to_card', 'lump_sum', 'manual', 'online_gateway') NOT NULL
  - `status`: ENUM('pending', 'approved', 'rejected') DEFAULT 'pending'
  - `receipt_number`: VARCHAR(100) NULL
  - `receipt_file_path`: VARCHAR(255) NULL
  - `reject_reason`: TEXT NULL
  - `paid_at`: DATETIME NOT NULL
  - `verified_by_user_id`: INT NULL REFERENCES `users(id)`
  - `idempotency_key`: VARCHAR(100) UNIQUE NULL
  - `created_at`, `updated_at`: DATETIME

### ۱.۶ مدارک و گواهینامه‌ها
- **`certificate_templates`**:
  - `id`: INT AUTO_INCREMENT PRIMARY KEY
  - `title`: VARCHAR(100) NOT NULL
  - `template_html`: TEXT NOT NULL
  - `background_path`: VARCHAR(255) NULL
  - `is_default`: BOOLEAN DEFAULT FALSE
  - `created_at`, `updated_at`: DATETIME

- **`certificates`**:
  - `id`: INT AUTO_INCREMENT PRIMARY KEY
  - `enrollment_id`: INT UNIQUE NOT NULL REFERENCES `enrollments(id)` ON DELETE RESTRICT
  - `certificate_code`: VARCHAR(64) UNIQUE NOT NULL
  - `template_id`: INT NOT NULL REFERENCES `certificate_templates(id)`
  - `title`: VARCHAR(200) NOT NULL
  - `recipient_name`: VARCHAR(150) NOT NULL
  - `course_title`: VARCHAR(150) NOT NULL
  - `issue_date`: DATE NOT NULL
  - `file_path`: VARCHAR(255) NULL
  - `qr_code_path`: VARCHAR(255) NULL
  - `status`: ENUM('active', 'revoked') DEFAULT 'active'
  - `revoke_reason`: TEXT NULL
  - `revoked_at`: DATETIME NULL
  - `revoked_by_user_id`: INT NULL REFERENCES `users(id)`
  - `created_at`, `updated_at`: DATETIME

### ۱.۷ سیستم پیامک و الگوهای IPPanel
- **`sms_templates`**:
  - `id`: INT AUTO_INCREMENT PRIMARY KEY
  - `event_key`: VARCHAR(50) UNIQUE NOT NULL (مانند `prereg_received`, `enrollment_confirmed`, `installment_reminder`)
  - `title`: VARCHAR(100) NOT NULL
  - `is_active`: BOOLEAN DEFAULT TRUE
  - `ippanel_pattern_code`: VARCHAR(50) NOT NULL
  - `variable_mappings_json`: JSON / TEXT NOT NULL
  - `default_values_json`: JSON / TEXT NULL
  - `created_at`, `updated_at`: DATETIME

- **`sms_logs`**:
  - `id`: BIGINT AUTO_INCREMENT PRIMARY KEY
  - `event_key`: VARCHAR(50) NOT NULL
  - `recipient_mobile`: VARCHAR(20) NOT NULL
  - `pattern_code`: VARCHAR(50) NOT NULL
  - `payload_json`: JSON / TEXT NOT NULL
  - `status`: ENUM('queued', 'sent', 'delivered', 'failed') DEFAULT 'queued'
  - `provider_message_id`: VARCHAR(100) NULL
  - `error_message`: TEXT NULL
  - `idempotency_key`: VARCHAR(100) UNIQUE NOT NULL
  - `attempts`: INT DEFAULT 0
  - `scheduled_at`: DATETIME NOT NULL
  - `sent_at`: DATETIME NULL
  - `created_at`: DATETIME NOT NULL

### ۱.۸ فایل‌ها و تنظیمات سامانه
- **`system_settings`**:
  - `key`: VARCHAR(100) PRIMARY KEY
  - `value_json`: JSON / TEXT NOT NULL
  - `category`: VARCHAR(50) NOT NULL
  - `is_secret`: BOOLEAN DEFAULT FALSE
  - `updated_at`: DATETIME NOT NULL

- **`files`**:
  - `id`: BIGINT AUTO_INCREMENT PRIMARY KEY
  - `original_name`: VARCHAR(255) NOT NULL
  - `stored_name`: VARCHAR(255) NOT NULL
  - `file_path`: VARCHAR(500) NOT NULL
  - `mime_type`: VARCHAR(100) NOT NULL
  - `size_bytes`: BIGINT NOT NULL
  - `entity_type`: VARCHAR(50) NOT NULL
  - `entity_id`: VARCHAR(50) NOT NULL
  - `uploaded_by_user_id`: INT NOT NULL REFERENCES `users(id)`
  - `created_at`: DATETIME NOT NULL
