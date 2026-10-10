"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMigrations = runMigrations;
exports.seedDefaults = seedDefaults;
const kysely_1 = require("kysely");
const logger_1 = require("./logger");
const config_1 = require("./config");
async function runMigrations(db) {
    const isMysql = config_1.config.DB_DIALECT === 'mysql';
    logger_1.logger.info(`Starting migration execution (Dialect: ${config_1.config.DB_DIALECT})...`);
    const autoInc = isMysql ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    const bigintType = isMysql ? 'BIGINT' : 'INTEGER';
    const textJson = isMysql ? 'LONGTEXT' : 'TEXT';
    // 1. system_settings
    await (0, kysely_1.sql) `
    CREATE TABLE IF NOT EXISTS system_settings (
      \`key\` VARCHAR(100) PRIMARY KEY,
      value_json ${kysely_1.sql.raw(textJson)} NOT NULL,
      category VARCHAR(50) NOT NULL,
      is_secret TINYINT(1) DEFAULT 0,
      updated_at DATETIME NOT NULL
    )
  `.execute(db);
    // 2. roles
    await (0, kysely_1.sql) `
    CREATE TABLE IF NOT EXISTS roles (
      id ${kysely_1.sql.raw(autoInc)},
      name VARCHAR(50) UNIQUE NOT NULL,
      title_fa VARCHAR(100) NOT NULL,
      is_system TINYINT(1) DEFAULT 0,
      permissions_json ${kysely_1.sql.raw(textJson)} NOT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL
    )
  `.execute(db);
    // 3. users
    await (0, kysely_1.sql) `
    CREATE TABLE IF NOT EXISTS users (
      id ${kysely_1.sql.raw(autoInc)},
      full_name VARCHAR(150) NOT NULL,
      mobile VARCHAR(20) UNIQUE NOT NULL,
      email VARCHAR(150) UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role_id INT NOT NULL,
      status VARCHAR(20) DEFAULT 'active',
      avatar_path VARCHAR(255),
      must_change_password TINYINT(1) DEFAULT 0,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      deleted_at DATETIME,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT
    )
  `.execute(db);
    // 4. sessions
    await (0, kysely_1.sql) `
    CREATE TABLE IF NOT EXISTS sessions (
      id VARCHAR(128) PRIMARY KEY,
      user_id INT NOT NULL,
      ip_address VARCHAR(45) NOT NULL,
      user_agent VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `.execute(db);
    // 5. audit_logs
    await (0, kysely_1.sql) `
    CREATE TABLE IF NOT EXISTS audit_logs (
      id ${kysely_1.sql.raw(autoInc)},
      user_id INT,
      action VARCHAR(100) NOT NULL,
      entity_type VARCHAR(50) NOT NULL,
      entity_id VARCHAR(50) NOT NULL,
      old_values_json ${kysely_1.sql.raw(textJson)},
      new_values_json ${kysely_1.sql.raw(textJson)},
      ip_address VARCHAR(45) NOT NULL,
      created_at DATETIME NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `.execute(db);
    // 6. teachers
    await (0, kysely_1.sql) `
    CREATE TABLE IF NOT EXISTS teachers (
      id ${kysely_1.sql.raw(autoInc)},
      user_id INT UNIQUE NOT NULL,
      internal_code VARCHAR(50) UNIQUE NOT NULL,
      specialties ${kysely_1.sql.raw(textJson)},
      bio ${kysely_1.sql.raw(textJson)},
      contract_status VARCHAR(20) DEFAULT 'active',
      contract_start_date DATE,
      management_notes ${kysely_1.sql.raw(textJson)},
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `.execute(db);
    // 7. students
    await (0, kysely_1.sql) `
    CREATE TABLE IF NOT EXISTS students (
      id ${kysely_1.sql.raw(autoInc)},
      user_id INT UNIQUE NOT NULL,
      student_code VARCHAR(50) UNIQUE NOT NULL,
      national_id VARCHAR(20),
      emergency_contact VARCHAR(50),
      parent_name VARCHAR(150),
      parent_phone VARCHAR(20),
      address ${kysely_1.sql.raw(textJson)},
      internal_notes ${kysely_1.sql.raw(textJson)},
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      deleted_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `.execute(db);
    // 8. courses
    await (0, kysely_1.sql) `
    CREATE TABLE IF NOT EXISTS courses (
      id ${kysely_1.sql.raw(autoInc)},
      title VARCHAR(150) NOT NULL,
      code VARCHAR(50) UNIQUE NOT NULL,
      category VARCHAR(100) NOT NULL,
      level VARCHAR(50) NOT NULL,
      description ${kysely_1.sql.raw(textJson)},
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      deleted_at DATETIME
    )
  `.execute(db);
    // 9. classes
    await (0, kysely_1.sql) `
    CREATE TABLE IF NOT EXISTS classes (
      id ${kysely_1.sql.raw(autoInc)},
      course_id INT NOT NULL,
      title VARCHAR(150) NOT NULL,
      code VARCHAR(50) UNIQUE NOT NULL,
      capacity INT NOT NULL,
      tuition_fee ${kysely_1.sql.raw(bigintType)} NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      schedule_days VARCHAR(100) NOT NULL,
      start_time VARCHAR(20) NOT NULL,
      end_time VARCHAR(20) NOT NULL,
      location VARCHAR(150) NOT NULL,
      status VARCHAR(30) DEFAULT 'draft',
      poster_path VARCHAR(255),
      prereg_enabled TINYINT(1) DEFAULT 0,
      prereg_fields_json ${kysely_1.sql.raw(textJson)},
      min_attendance_percent INT DEFAULT 70,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      deleted_at DATETIME,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE RESTRICT
    )
  `.execute(db);
    // 10. class_teachers
    await (0, kysely_1.sql) `
    CREATE TABLE IF NOT EXISTS class_teachers (
      id ${kysely_1.sql.raw(autoInc)},
      class_id INT NOT NULL,
      teacher_id INT NOT NULL,
      role_in_class VARCHAR(50) DEFAULT 'primary',
      created_at DATETIME NOT NULL,
      UNIQUE (class_id, teacher_id),
      FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
      FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE RESTRICT
    )
  `.execute(db);
    // 11. class_sessions
    await (0, kysely_1.sql) `
    CREATE TABLE IF NOT EXISTS class_sessions (
      id ${kysely_1.sql.raw(autoInc)},
      class_id INT NOT NULL,
      session_number INT NOT NULL,
      session_date DATE NOT NULL,
      start_time VARCHAR(20) NOT NULL,
      end_time VARCHAR(20) NOT NULL,
      topic VARCHAR(255),
      teacher_id INT,
      status VARCHAR(30) DEFAULT 'scheduled',
      notes ${kysely_1.sql.raw(textJson)},
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
      FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
    )
  `.execute(db);
    // 12. preregistrations
    await (0, kysely_1.sql) `
    CREATE TABLE IF NOT EXISTS preregistrations (
      id ${kysely_1.sql.raw(autoInc)},
      class_id INT NOT NULL,
      tracking_code VARCHAR(50) UNIQUE NOT NULL,
      full_name VARCHAR(150) NOT NULL,
      mobile VARCHAR(20) NOT NULL,
      email VARCHAR(150),
      extra_data_json ${kysely_1.sql.raw(textJson)},
      attachment_path VARCHAR(255),
      status VARCHAR(30) DEFAULT 'pending',
      reject_reason ${kysely_1.sql.raw(textJson)},
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE RESTRICT
    )
  `.execute(db);
    // 13. enrollments
    await (0, kysely_1.sql) `
    CREATE TABLE IF NOT EXISTS enrollments (
      id ${kysely_1.sql.raw(autoInc)},
      student_id INT NOT NULL,
      class_id INT NOT NULL,
      preregistration_id INT,
      status VARCHAR(30) DEFAULT 'active',
      tuition_agreed ${kysely_1.sql.raw(bigintType)} NOT NULL,
      notes ${kysely_1.sql.raw(textJson)},
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      UNIQUE (student_id, class_id),
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT,
      FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE RESTRICT,
      FOREIGN KEY (preregistration_id) REFERENCES preregistrations(id) ON DELETE SET NULL
    )
  `.execute(db);
    // 14. attendance_records
    await (0, kysely_1.sql) `
    CREATE TABLE IF NOT EXISTS attendance_records (
      id ${kysely_1.sql.raw(autoInc)},
      session_id INT NOT NULL,
      student_id INT NOT NULL,
      status VARCHAR(20) DEFAULT 'unrecorded',
      note VARCHAR(255),
      recorded_by_user_id INT NOT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      UNIQUE (session_id, student_id),
      FOREIGN KEY (session_id) REFERENCES class_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT,
      FOREIGN KEY (recorded_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
    )
  `.execute(db);
    // 15. installments
    await (0, kysely_1.sql) `
    CREATE TABLE IF NOT EXISTS installments (
      id ${kysely_1.sql.raw(autoInc)},
      enrollment_id INT NOT NULL,
      installment_number INT NOT NULL,
      amount ${kysely_1.sql.raw(bigintType)} NOT NULL,
      due_date DATE NOT NULL,
      status VARCHAR(30) DEFAULT 'pending',
      paid_amount ${kysely_1.sql.raw(bigintType)} DEFAULT 0,
      notes VARCHAR(255),
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE CASCADE
    )
  `.execute(db);
    // 16. payments
    await (0, kysely_1.sql) `
    CREATE TABLE IF NOT EXISTS payments (
      id ${kysely_1.sql.raw(autoInc)},
      enrollment_id INT NOT NULL,
      installment_id INT,
      amount ${kysely_1.sql.raw(bigintType)} NOT NULL,
      payment_method VARCHAR(30) NOT NULL,
      status VARCHAR(30) DEFAULT 'pending',
      receipt_number VARCHAR(100),
      receipt_file_path VARCHAR(255),
      reject_reason ${kysely_1.sql.raw(textJson)},
      paid_at DATETIME NOT NULL,
      verified_by_user_id INT,
      idempotency_key VARCHAR(100) UNIQUE,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE RESTRICT,
      FOREIGN KEY (installment_id) REFERENCES installments(id) ON DELETE SET NULL,
      FOREIGN KEY (verified_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `.execute(db);
    // 17. certificate_templates
    await (0, kysely_1.sql) `
    CREATE TABLE IF NOT EXISTS certificate_templates (
      id ${kysely_1.sql.raw(autoInc)},
      title VARCHAR(100) NOT NULL,
      template_html ${kysely_1.sql.raw(textJson)} NOT NULL,
      background_path VARCHAR(255),
      is_default TINYINT(1) DEFAULT 0,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL
    )
  `.execute(db);
    // 18. certificates
    await (0, kysely_1.sql) `
    CREATE TABLE IF NOT EXISTS certificates (
      id ${kysely_1.sql.raw(autoInc)},
      enrollment_id INT UNIQUE NOT NULL,
      certificate_code VARCHAR(64) UNIQUE NOT NULL,
      template_id INT NOT NULL,
      title VARCHAR(200) NOT NULL,
      recipient_name VARCHAR(150) NOT NULL,
      course_title VARCHAR(150) NOT NULL,
      issue_date DATE NOT NULL,
      file_path VARCHAR(255),
      qr_code_path VARCHAR(255),
      status VARCHAR(20) DEFAULT 'active',
      revoke_reason ${kysely_1.sql.raw(textJson)},
      revoked_at DATETIME,
      revoked_by_user_id INT,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE RESTRICT,
      FOREIGN KEY (template_id) REFERENCES certificate_templates(id) ON DELETE RESTRICT,
      FOREIGN KEY (revoked_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `.execute(db);
    // 19. sms_templates
    await (0, kysely_1.sql) `
    CREATE TABLE IF NOT EXISTS sms_templates (
      id ${kysely_1.sql.raw(autoInc)},
      event_key VARCHAR(50) UNIQUE NOT NULL,
      title VARCHAR(100) NOT NULL,
      is_active TINYINT(1) DEFAULT 1,
      ippanel_pattern_code VARCHAR(50) NOT NULL,
      variable_mappings_json ${kysely_1.sql.raw(textJson)} NOT NULL,
      default_values_json ${kysely_1.sql.raw(textJson)},
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL
    )
  `.execute(db);
    // 20. sms_logs
    await (0, kysely_1.sql) `
    CREATE TABLE IF NOT EXISTS sms_logs (
      id ${kysely_1.sql.raw(autoInc)},
      event_key VARCHAR(50) NOT NULL,
      recipient_mobile VARCHAR(20) NOT NULL,
      pattern_code VARCHAR(50) NOT NULL,
      payload_json ${kysely_1.sql.raw(textJson)} NOT NULL,
      status VARCHAR(20) DEFAULT 'queued',
      provider_message_id VARCHAR(100),
      error_message ${kysely_1.sql.raw(textJson)},
      idempotency_key VARCHAR(100) UNIQUE NOT NULL,
      attempts INT DEFAULT 0,
      scheduled_at DATETIME NOT NULL,
      sent_at DATETIME,
      created_at DATETIME NOT NULL
    )
  `.execute(db);
    // 21. files
    await (0, kysely_1.sql) `
    CREATE TABLE IF NOT EXISTS files (
      id ${kysely_1.sql.raw(autoInc)},
      original_name VARCHAR(255) NOT NULL,
      stored_name VARCHAR(255) NOT NULL,
      file_path VARCHAR(500) NOT NULL,
      mime_type VARCHAR(100) NOT NULL,
      size_bytes ${kysely_1.sql.raw(bigintType)} NOT NULL,
      entity_type VARCHAR(50) NOT NULL,
      entity_id VARCHAR(50) NOT NULL,
      uploaded_by_user_id INT NOT NULL,
      created_at DATETIME NOT NULL,
      FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `.execute(db);
    await seedDefaults(db);
    logger_1.logger.info('Migrations and default seeds executed successfully.');
}
async function seedDefaults(db) {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    // Seed default system roles if empty
    const existingRoles = await db.selectFrom('roles').select('id').execute();
    if (existingRoles.length === 0) {
        const defaultRoles = [
            {
                name: 'super_admin',
                title_fa: 'مدیر اصلی سامانه',
                is_system: 1,
                permissions_json: JSON.stringify(['*']),
                created_at: now,
                updated_at: now
            },
            {
                name: 'executive_manager',
                title_fa: 'مدیر اجرایی',
                is_system: 1,
                permissions_json: JSON.stringify(['courses.*', 'classes.*', 'teachers.*', 'students.*', 'enrollment.*', 'attendance.*', 'reports.*', 'certificates.*']),
                created_at: now,
                updated_at: now
            },
            {
                name: 'education_manager',
                title_fa: 'مدیر آموزش',
                is_system: 1,
                permissions_json: JSON.stringify(['courses.*', 'classes.*', 'sessions.*', 'teachers.read', 'students.read', 'attendance.*', 'certificates.*']),
                created_at: now,
                updated_at: now
            },
            {
                name: 'registrar',
                title_fa: 'کارمند ثبت‌نام',
                is_system: 1,
                permissions_json: JSON.stringify(['preregistration.*', 'students.*', 'enrollment.*', 'classes.read']),
                created_at: now,
                updated_at: now
            },
            {
                name: 'finance_staff',
                title_fa: 'کارشناس مالی',
                is_system: 1,
                permissions_json: JSON.stringify(['finance.*', 'students.read', 'enrollment.read', 'reports.finance']),
                created_at: now,
                updated_at: now
            },
            {
                name: 'attendance_officer',
                title_fa: 'مسئول حضور و غیاب',
                is_system: 1,
                permissions_json: JSON.stringify(['attendance.*', 'classes.read', 'sessions.read']),
                created_at: now,
                updated_at: now
            },
            {
                name: 'teacher',
                title_fa: 'استاد',
                is_system: 1,
                permissions_json: JSON.stringify(['teacher_portal.access', 'attendance.record', 'sessions.read']),
                created_at: now,
                updated_at: now
            },
            {
                name: 'student',
                title_fa: 'فراگیر',
                is_system: 1,
                permissions_json: JSON.stringify(['student_portal.access']),
                created_at: now,
                updated_at: now
            }
        ];
        for (const r of defaultRoles) {
            await db.insertInto('roles').values(r).execute();
        }
    }
    // Seed default system settings if empty
    const existingSettings = await db.selectFrom('system_settings').select('key').execute();
    if (existingSettings.length === 0) {
        const defaultSettings = [
            { key: 'institution_name', value_json: JSON.stringify('مؤسسه آموزشی نمونه آکادمی'), category: 'general', is_secret: 0, updated_at: now },
            { key: 'institution_brand', value_json: JSON.stringify('آکادمی تخصصی مهارت'), category: 'general', is_secret: 0, updated_at: now },
            { key: 'institution_slogan', value_json: JSON.stringify('یادگیری هدفمند برای ورود به بازار کار'), category: 'general', is_secret: 0, updated_at: now },
            { key: 'institution_phone', value_json: JSON.stringify('۰۲۱-۸۸۸۸۸۸۸۸'), category: 'general', is_secret: 0, updated_at: now },
            { key: 'institution_mobile', value_json: JSON.stringify('۰۹۱۲۰۰۰۰۰۰۰'), category: 'general', is_secret: 0, updated_at: now },
            { key: 'institution_email', value_json: JSON.stringify('info@academy.example.com'), category: 'general', is_secret: 0, updated_at: now },
            { key: 'institution_address', value_json: JSON.stringify('تهران، خیابان آزادی، میدان انقلاب، پلاک ۱'), category: 'general', is_secret: 0, updated_at: now },
            { key: 'institution_website', value_json: JSON.stringify('https://academy.example.com'), category: 'general', is_secret: 0, updated_at: now },
            { key: 'institution_manager_name', value_json: JSON.stringify('دکتر علیرضا محمدی'), category: 'general', is_secret: 0, updated_at: now },
            { key: 'certificate_signatory_title', value_json: JSON.stringify('مدیر آموزش و صدور گواهینامه'), category: 'certificates', is_secret: 0, updated_at: now },
            { key: 'currency_unit', value_json: JSON.stringify('تومان'), category: 'finance', is_secret: 0, updated_at: now },
            { key: 'calendar_system', value_json: JSON.stringify('jalali'), category: 'general', is_secret: 0, updated_at: now },
            { key: 'installed', value_json: JSON.stringify(false), category: 'installer', is_secret: 0, updated_at: now },
            { key: 'ippanel_api_key', value_json: JSON.stringify(''), category: 'sms', is_secret: 1, updated_at: now },
            { key: 'ippanel_sender', value_json: JSON.stringify('+983000505'), category: 'sms', is_secret: 0, updated_at: now },
            { key: 'sms_enabled', value_json: JSON.stringify(false), category: 'sms', is_secret: 0, updated_at: now }
        ];
        for (const s of defaultSettings) {
            await db.insertInto('system_settings').values(s).execute();
        }
    }
    // Seed default certificate template if empty
    const existingTemplates = await db.selectFrom('certificate_templates').select('id').execute();
    if (existingTemplates.length === 0) {
        const defaultTemplateHtml = `
      <div style="direction: rtl; font-family: 'Vazirmatn', Tahoma, sans-serif; border: 12px double #1e3a8a; padding: 40px; text-align: center; background: #fafafa; position: relative;">
        <h1 style="color: #1e3a8a; margin-bottom: 5px;">{{institution_name}}</h1>
        <h3 style="color: #4b5563; margin-top: 0;">گواهینامه رسمی پایان دوره آموزشی</h3>
        <p style="font-size: 18px; line-height: 2; margin: 30px 0;">
          بدین‌وسیله گواهی می‌شود سرکار خانم / جناب آقای <strong>{{recipient_name}}</strong> دوره آموزشی تخصصی <strong>{{course_title}}</strong> را به مدت <strong>{{duration_hours}}</strong> ساعت با موفقیت به پایان رسانده است.
        </p>
        <div style="display: flex; justify-content: space-between; margin-top: 60px; padding: 0 40px;">
          <div>
            <p><strong>تاریخ صدور:</strong> {{issue_date}}</p>
            <p><strong>شماره رهگیری:</strong> {{certificate_code}}</p>
          </div>
          <div style="text-align: center;">
            <p>{{institution_manager_name}}</p>
            <p style="color: #6b7280; font-size: 14px;">{{certificate_signatory_title}}</p>
          </div>
        </div>
      </div>
    `;
        await db.insertInto('certificate_templates').values({
            title: 'قالب رسمی استاندارد فارسی',
            template_html: defaultTemplateHtml,
            background_path: null,
            is_default: 1,
            created_at: now,
            updated_at: now
        }).execute();
    }
    // Seed default SMS templates if empty
    const existingSms = await db.selectFrom('sms_templates').select('id').execute();
    if (existingSms.length === 0) {
        const defaultSms = [
            {
                event_key: 'prereg_received',
                title: 'دریافت درخواست پیش‌ثبت‌نام',
                is_active: 1,
                ippanel_pattern_code: 'p_prereg_received',
                variable_mappings_json: JSON.stringify({ name: 'applicant_name', code: 'tracking_code', class: 'class_title' }),
                default_values_json: JSON.stringify({}),
                created_at: now,
                updated_at: now
            },
            {
                event_key: 'enrollment_confirmed',
                title: 'تأیید نهایی و ثبت‌نام در کلاس',
                is_active: 1,
                ippanel_pattern_code: 'p_enrollment_confirmed',
                variable_mappings_json: JSON.stringify({ name: 'student_name', class: 'class_title', date: 'start_date' }),
                default_values_json: JSON.stringify({}),
                created_at: now,
                updated_at: now
            },
            {
                event_key: 'installment_reminder',
                title: 'یادآوری سررسید قسط شهریه',
                is_active: 1,
                ippanel_pattern_code: 'p_installment_reminder',
                variable_mappings_json: JSON.stringify({ name: 'student_name', amount: 'amount', due_date: 'due_date' }),
                default_values_json: JSON.stringify({}),
                created_at: now,
                updated_at: now
            },
            {
                event_key: 'payment_verified',
                title: 'تأیید رسید پرداخت شهریه',
                is_active: 1,
                ippanel_pattern_code: 'p_payment_verified',
                variable_mappings_json: JSON.stringify({ name: 'student_name', amount: 'amount', receipt: 'receipt_number' }),
                default_values_json: JSON.stringify({}),
                created_at: now,
                updated_at: now
            },
            {
                event_key: 'certificate_ready',
                title: 'آماده‌شدن مدرک دوره',
                is_active: 1,
                ippanel_pattern_code: 'p_certificate_ready',
                variable_mappings_json: JSON.stringify({ name: 'student_name', course: 'course_title', code: 'certificate_code' }),
                default_values_json: JSON.stringify({}),
                created_at: now,
                updated_at: now
            }
        ];
        for (const s of defaultSms) {
            await db.insertInto('sms_templates').values(s).execute();
        }
    }
}
