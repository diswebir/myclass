-- =====================================================================
-- MyClass Academy Management Platform - Full Standalone Database Schema
-- Compatible with MySQL 5.7+ / 8.0+ and MariaDB 10.3+ for cPanel Hosting
-- Charset: utf8mb4, Collation: utf8mb4_unicode_ci
-- =====================================================================

SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";

-- 1. system_settings
CREATE TABLE IF NOT EXISTS `system_settings` (
  `key` VARCHAR(100) NOT NULL,
  `value_json` LONGTEXT NOT NULL,
  `category` VARCHAR(50) NOT NULL,
  `is_secret` TINYINT(1) DEFAULT 0,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. roles
CREATE TABLE IF NOT EXISTS `roles` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(50) UNIQUE NOT NULL,
  `title_fa` VARCHAR(100) NOT NULL,
  `is_system` TINYINT(1) DEFAULT 0,
  `permissions_json` LONGTEXT NOT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. users
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `full_name` VARCHAR(150) NOT NULL,
  `mobile` VARCHAR(20) UNIQUE NOT NULL,
  `email` VARCHAR(150) UNIQUE DEFAULT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role_id` INT NOT NULL,
  `status` VARCHAR(20) DEFAULT 'active',
  `avatar_path` VARCHAR(255) DEFAULT NULL,
  `must_change_password` TINYINT(1) DEFAULT 0,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  `deleted_at` DATETIME DEFAULT NULL,
  CONSTRAINT `fk_users_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. sessions
CREATE TABLE IF NOT EXISTS `sessions` (
  `id` VARCHAR(128) NOT NULL PRIMARY KEY,
  `user_id` INT NOT NULL,
  `ip_address` VARCHAR(45) NOT NULL,
  `user_agent` VARCHAR(255) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL,
  CONSTRAINT `fk_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. audit_logs
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT DEFAULT NULL,
  `action` VARCHAR(100) NOT NULL,
  `entity_type` VARCHAR(50) NOT NULL,
  `entity_id` VARCHAR(50) NOT NULL,
  `old_values_json` LONGTEXT DEFAULT NULL,
  `new_values_json` LONGTEXT DEFAULT NULL,
  `ip_address` VARCHAR(45) NOT NULL,
  `created_at` DATETIME NOT NULL,
  CONSTRAINT `fk_audit_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. teachers
CREATE TABLE IF NOT EXISTS `teachers` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT UNIQUE NOT NULL,
  `internal_code` VARCHAR(50) UNIQUE NOT NULL,
  `specialties` LONGTEXT DEFAULT NULL,
  `bio` LONGTEXT DEFAULT NULL,
  `contract_status` VARCHAR(20) DEFAULT 'active',
  `contract_start_date` DATE DEFAULT NULL,
  `management_notes` LONGTEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  CONSTRAINT `fk_teachers_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. students
CREATE TABLE IF NOT EXISTS `students` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT UNIQUE NOT NULL,
  `student_code` VARCHAR(50) UNIQUE NOT NULL,
  `national_id` VARCHAR(20) DEFAULT NULL,
  `emergency_contact` VARCHAR(50) DEFAULT NULL,
  `parent_name` VARCHAR(150) DEFAULT NULL,
  `parent_phone` VARCHAR(20) DEFAULT NULL,
  `address` LONGTEXT DEFAULT NULL,
  `internal_notes` LONGTEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  `deleted_at` DATETIME DEFAULT NULL,
  CONSTRAINT `fk_students_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. courses
CREATE TABLE IF NOT EXISTS `courses` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `title` VARCHAR(150) NOT NULL,
  `code` VARCHAR(50) UNIQUE NOT NULL,
  `category` VARCHAR(100) NOT NULL,
  `level` VARCHAR(50) NOT NULL,
  `description` LONGTEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  `deleted_at` DATETIME DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. classes
CREATE TABLE IF NOT EXISTS `classes` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `course_id` INT NOT NULL,
  `title` VARCHAR(150) NOT NULL,
  `code` VARCHAR(50) UNIQUE NOT NULL,
  `capacity` INT NOT NULL,
  `tuition_fee` BIGINT NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `schedule_days` VARCHAR(100) NOT NULL,
  `start_time` VARCHAR(20) NOT NULL,
  `end_time` VARCHAR(20) NOT NULL,
  `location` VARCHAR(150) NOT NULL,
  `status` VARCHAR(30) DEFAULT 'draft',
  `poster_path` VARCHAR(255) DEFAULT NULL,
  `prereg_enabled` TINYINT(1) DEFAULT 0,
  `prereg_fields_json` LONGTEXT DEFAULT NULL,
  `min_attendance_percent` INT DEFAULT 70,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  `deleted_at` DATETIME DEFAULT NULL,
  CONSTRAINT `fk_classes_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. class_teachers
CREATE TABLE IF NOT EXISTS `class_teachers` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `class_id` INT NOT NULL,
  `teacher_id` INT NOT NULL,
  `role_in_class` VARCHAR(50) DEFAULT 'primary',
  `created_at` DATETIME NOT NULL,
  UNIQUE KEY `uk_class_teacher` (`class_id`, `teacher_id`),
  CONSTRAINT `fk_ct_class` FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ct_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. class_sessions
CREATE TABLE IF NOT EXISTS `class_sessions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `class_id` INT NOT NULL,
  `session_number` INT NOT NULL,
  `session_date` DATE NOT NULL,
  `start_time` VARCHAR(20) NOT NULL,
  `end_time` VARCHAR(20) NOT NULL,
  `topic` VARCHAR(255) DEFAULT NULL,
  `teacher_id` INT DEFAULT NULL,
  `status` VARCHAR(30) DEFAULT 'scheduled',
  `notes` LONGTEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  CONSTRAINT `fk_session_class` FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_session_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. preregistrations
CREATE TABLE IF NOT EXISTS `preregistrations` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `class_id` INT NOT NULL,
  `tracking_code` VARCHAR(50) UNIQUE NOT NULL,
  `full_name` VARCHAR(150) NOT NULL,
  `mobile` VARCHAR(20) NOT NULL,
  `email` VARCHAR(150) DEFAULT NULL,
  `extra_data_json` LONGTEXT DEFAULT NULL,
  `attachment_path` VARCHAR(255) DEFAULT NULL,
  `status` VARCHAR(30) DEFAULT 'pending',
  `reject_reason` LONGTEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  CONSTRAINT `fk_prereg_class` FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 13. enrollments
CREATE TABLE IF NOT EXISTS `enrollments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL,
  `class_id` INT NOT NULL,
  `preregistration_id` INT DEFAULT NULL,
  `status` VARCHAR(30) DEFAULT 'active',
  `tuition_agreed` BIGINT NOT NULL,
  `notes` LONGTEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  UNIQUE KEY `uk_student_class` (`student_id`, `class_id`),
  CONSTRAINT `fk_enr_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_enr_class` FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_enr_prereg` FOREIGN KEY (`preregistration_id`) REFERENCES `preregistrations` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 14. attendance_records
CREATE TABLE IF NOT EXISTS `attendance_records` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `session_id` INT NOT NULL,
  `student_id` INT NOT NULL,
  `status` VARCHAR(20) DEFAULT 'unrecorded',
  `note` VARCHAR(255) DEFAULT NULL,
  `recorded_by_user_id` INT NOT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  UNIQUE KEY `uk_session_student` (`session_id`, `student_id`),
  CONSTRAINT `fk_att_session` FOREIGN KEY (`session_id`) REFERENCES `class_sessions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_att_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_att_recorder` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 15. installments
CREATE TABLE IF NOT EXISTS `installments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `enrollment_id` INT NOT NULL,
  `installment_number` INT NOT NULL,
  `amount` BIGINT NOT NULL,
  `due_date` DATE NOT NULL,
  `status` VARCHAR(30) DEFAULT 'pending',
  `paid_amount` BIGINT DEFAULT 0,
  `notes` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  CONSTRAINT `fk_inst_enrollment` FOREIGN KEY (`enrollment_id`) REFERENCES `enrollments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 16. payments
CREATE TABLE IF NOT EXISTS `payments` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `enrollment_id` INT NOT NULL,
  `installment_id` INT DEFAULT NULL,
  `amount` BIGINT NOT NULL,
  `payment_method` VARCHAR(30) NOT NULL,
  `status` VARCHAR(30) DEFAULT 'pending',
  `receipt_number` VARCHAR(100) DEFAULT NULL,
  `receipt_file_path` VARCHAR(255) DEFAULT NULL,
  `reject_reason` LONGTEXT DEFAULT NULL,
  `paid_at` DATETIME NOT NULL,
  `verified_by_user_id` INT DEFAULT NULL,
  `idempotency_key` VARCHAR(100) UNIQUE DEFAULT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  CONSTRAINT `fk_pay_enrollment` FOREIGN KEY (`enrollment_id`) REFERENCES `enrollments` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_pay_installment` FOREIGN KEY (`installment_id`) REFERENCES `installments` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_pay_verifier` FOREIGN KEY (`verified_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 17. certificate_templates
CREATE TABLE IF NOT EXISTS `certificate_templates` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `title` VARCHAR(100) NOT NULL,
  `template_html` LONGTEXT NOT NULL,
  `background_path` VARCHAR(255) DEFAULT NULL,
  `is_default` TINYINT(1) DEFAULT 0,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 18. certificates
CREATE TABLE IF NOT EXISTS `certificates` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `enrollment_id` INT UNIQUE NOT NULL,
  `certificate_code` VARCHAR(64) UNIQUE NOT NULL,
  `template_id` INT NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `recipient_name` VARCHAR(150) NOT NULL,
  `course_title` VARCHAR(150) NOT NULL,
  `issue_date` DATE NOT NULL,
  `file_path` VARCHAR(255) DEFAULT NULL,
  `qr_code_path` VARCHAR(255) DEFAULT NULL,
  `status` VARCHAR(20) DEFAULT 'active',
  `revoke_reason` LONGTEXT DEFAULT NULL,
  `revoked_at` DATETIME DEFAULT NULL,
  `revoked_by_user_id` INT DEFAULT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  CONSTRAINT `fk_cert_enrollment` FOREIGN KEY (`enrollment_id`) REFERENCES `enrollments` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_cert_template` FOREIGN KEY (`template_id`) REFERENCES `certificate_templates` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_cert_revoker` FOREIGN KEY (`revoked_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 19. sms_templates
CREATE TABLE IF NOT EXISTS `sms_templates` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `event_key` VARCHAR(50) UNIQUE NOT NULL,
  `title` VARCHAR(100) NOT NULL,
  `is_active` TINYINT(1) DEFAULT 1,
  `ippanel_pattern_code` VARCHAR(50) NOT NULL,
  `variable_mappings_json` LONGTEXT NOT NULL,
  `default_values_json` LONGTEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 20. sms_logs
CREATE TABLE IF NOT EXISTS `sms_logs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `event_key` VARCHAR(50) NOT NULL,
  `recipient_mobile` VARCHAR(20) NOT NULL,
  `pattern_code` VARCHAR(50) NOT NULL,
  `payload_json` LONGTEXT NOT NULL,
  `status` VARCHAR(20) DEFAULT 'queued',
  `provider_message_id` VARCHAR(100) DEFAULT NULL,
  `error_message` LONGTEXT DEFAULT NULL,
  `idempotency_key` VARCHAR(100) UNIQUE NOT NULL,
  `attempts` INT DEFAULT 0,
  `scheduled_at` DATETIME NOT NULL,
  `sent_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 21. files
CREATE TABLE IF NOT EXISTS `files` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `original_name` VARCHAR(255) NOT NULL,
  `stored_name` VARCHAR(255) NOT NULL,
  `file_path` VARCHAR(500) NOT NULL,
  `mime_type` VARCHAR(100) NOT NULL,
  `size_bytes` BIGINT NOT NULL,
  `entity_type` VARCHAR(50) NOT NULL,
  `entity_id` VARCHAR(50) NOT NULL,
  `uploaded_by_user_id` INT NOT NULL,
  `created_at` DATETIME NOT NULL,
  CONSTRAINT `fk_files_uploader` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
COMMIT;
