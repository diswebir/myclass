/**
 * طرح‌واره پایگاه‌داده — تعریف قابل حمل برای SQLite و MySQL
 * جدول‌ها به ترتیب وابستگی (برای کلیدهای خارجی) مرتب شده‌اند
 */

const schema = {
  _migrations: {
    columns: {
      id: { type: 'pk' },
      name: { type: 'string', size: 191, null: false },
      applied_at: { type: 'datetime', null: false },
    },
    indexes: [{ columns: ['name'], unique: true }],
  },

  sessions: {
    columns: {
      id: { type: 'pk' },
      sid: { type: 'string', size: 128, null: false },
      data: { type: 'longtext' },
      expires_at: { type: 'datetime', null: false },
    },
    indexes: [{ columns: ['sid'], unique: true }, { columns: ['expires_at'] }],
  },

  settings: {
    columns: {
      id: { type: 'pk' },
      setting_key: { type: 'string', size: 120, null: false },
      setting_value: { type: 'longtext' },
      setting_group: { type: 'string', size: 60, default: 'general' },
      updated_at: { type: 'datetime' },
    },
    indexes: [{ columns: ['setting_key'], unique: true }],
  },

  system_modules: {
    columns: {
      id: { type: 'pk' },
      code: { type: 'string', size: 60, null: false },
      title: { type: 'string', size: 120, null: false },
      description: { type: 'string', size: 255 },
      icon: { type: 'string', size: 60 },
      is_enabled: { type: 'bool', default: true, null: false },
      is_system: { type: 'bool', default: false, null: false },
      sort_order: { type: 'int', default: 0 },
    },
    indexes: [{ columns: ['code'], unique: true }],
  },

  permissions: {
    columns: {
      id: { type: 'pk' },
      code: { type: 'string', size: 80, null: false },
      title: { type: 'string', size: 150, null: false },
      module_code: { type: 'string', size: 60, null: false },
      sort_order: { type: 'int', default: 0 },
    },
    indexes: [{ columns: ['code'], unique: true }],
  },

  roles: {
    columns: {
      id: { type: 'pk' },
      title: { type: 'string', size: 120, null: false },
      description: { type: 'string', size: 255 },
      is_system: { type: 'bool', default: false, null: false },
      is_active: { type: 'bool', default: true, null: false },
      created_at: { type: 'datetime' },
    },
    indexes: [{ columns: ['title'], unique: true }],
  },

  role_permissions: {
    columns: {
      id: { type: 'pk' },
      role_id: { type: 'id', null: false },
      permission_id: { type: 'id', null: false },
    },
    indexes: [{ columns: ['role_id', 'permission_id'], unique: true }],
    foreignKeys: [
      { column: 'role_id', ref: 'roles(id)', onDelete: 'CASCADE' },
      { column: 'permission_id', ref: 'permissions(id)', onDelete: 'CASCADE' },
    ],
  },

  users: {
    columns: {
      id: { type: 'pk' },
      role_id: { type: 'id' },
      user_type: { type: 'string', size: 20, default: 'student' }, // admin|teacher|student|staff
      first_name: { type: 'string', size: 100, null: false },
      last_name: { type: 'string', size: 100, null: false },
      username: { type: 'string', size: 100, null: false },
      phone: { type: 'string', size: 20 },
      email: { type: 'string', size: 150 },
      national_code: { type: 'string', size: 20 },
      password_hash: { type: 'text', null: false },
      avatar_file: { type: 'string', size: 191 },
      is_active: { type: 'bool', default: true, null: false },
      must_change_password: { type: 'bool', default: false, null: false },
      last_login_at: { type: 'datetime' },
      created_by: { type: 'id' },
      created_at: { type: 'datetime' },
      updated_at: { type: 'datetime' },
    },
    indexes: [{ columns: ['username'], unique: true }, { columns: ['phone'] }, { columns: ['role_id'] }],
    foreignKeys: [{ column: 'role_id', ref: 'roles(id)', onDelete: 'SET NULL' }],
  },

  login_attempts: {
    columns: {
      id: { type: 'pk' },
      username: { type: 'string', size: 100, null: false },
      ip: { type: 'string', size: 60 },
      success: { type: 'bool', default: false, null: false },
      created_at: { type: 'datetime', null: false },
    },
    indexes: [{ columns: ['username', 'created_at'] }],
  },

  teacher_profiles: {
    columns: {
      id: { type: 'pk' },
      user_id: { type: 'id', null: false },
      expertise: { type: 'string', size: 191 },
      bio: { type: 'text' },
      hire_date: { type: 'date' },
      hourly_rate: { type: 'decimal' },
      notes: { type: 'text' },
    },
    indexes: [{ columns: ['user_id'], unique: true }],
    foreignKeys: [{ column: 'user_id', ref: 'users(id)', onDelete: 'CASCADE' }],
  },

  student_profiles: {
    columns: {
      id: { type: 'pk' },
      user_id: { type: 'id', null: false },
      student_code: { type: 'string', size: 40 },
      birth_date: { type: 'date' },
      gender: { type: 'string', size: 10 }, // male|female
      education_level: { type: 'string', size: 80 },
      school: { type: 'string', size: 150 },
      address: { type: 'text' },
      guardian_name: { type: 'string', size: 150 },
      guardian_phone: { type: 'string', size: 20 },
      notes: { type: 'text' },
    },
    indexes: [{ columns: ['user_id'], unique: true }, { columns: ['student_code'] }],
    foreignKeys: [{ column: 'user_id', ref: 'users(id)', onDelete: 'CASCADE' }],
  },

  classes: {
    columns: {
      id: { type: 'pk' },
      code: { type: 'string', size: 40, null: false },
      title: { type: 'string', size: 191, null: false },
      description: { type: 'text' },
      category: { type: 'string', size: 120 },
      level: { type: 'string', size: 80 },
      teacher_id: { type: 'id' },
      capacity: { type: 'int', default: 20 },
      price: { type: 'decimal', null: false, default: 0 },
      installments_count: { type: 'int', default: 1 },
      start_date: { type: 'date' },
      end_date: { type: 'date' },
      start_time: { type: 'time' },
      end_time: { type: 'time' },
      days_of_week: { type: 'string', size: 40 }, // مثل 0,2,4 (شنبه=0)
      location: { type: 'string', size: 191 },
      image_file: { type: 'string', size: 191 },
      passing_score: { type: 'decimal', default: 10 },
      certificate_enabled: { type: 'bool', default: true },
      status: { type: 'string', size: 20, default: 'open' }, // draft|open|in_progress|completed|cancelled
      created_by: { type: 'id' },
      created_at: { type: 'datetime' },
      updated_at: { type: 'datetime' },
    },
    indexes: [{ columns: ['code'], unique: true }, { columns: ['teacher_id'] }, { columns: ['status'] }],
    foreignKeys: [{ column: 'teacher_id', ref: 'users(id)', onDelete: 'SET NULL' }],
  },

  class_students: {
    columns: {
      id: { type: 'pk' },
      class_id: { type: 'id', null: false },
      student_id: { type: 'id', null: false },
      status: { type: 'string', size: 20, default: 'active' }, // active|finished|dropped
      enrolled_at: { type: 'datetime' },
      final_score: { type: 'decimal' },
      notes: { type: 'text' },
    },
    indexes: [{ columns: ['class_id', 'student_id'], unique: true }, { columns: ['student_id'] }],
    foreignKeys: [
      { column: 'class_id', ref: 'classes(id)', onDelete: 'CASCADE' },
      { column: 'student_id', ref: 'users(id)', onDelete: 'CASCADE' },
    ],
  },

  class_sessions: {
    columns: {
      id: { type: 'pk' },
      class_id: { type: 'id', null: false },
      session_date: { type: 'date', null: false },
      start_time: { type: 'time' },
      end_time: { type: 'time' },
      topic: { type: 'string', size: 191 },
      status: { type: 'string', size: 20, default: 'scheduled' }, // scheduled|held|cancelled
      notes: { type: 'text' },
      created_at: { type: 'datetime' },
    },
    indexes: [{ columns: ['class_id', 'session_date'] }],
    foreignKeys: [{ column: 'class_id', ref: 'classes(id)', onDelete: 'CASCADE' }],
  },

  attendance: {
    columns: {
      id: { type: 'pk' },
      session_id: { type: 'id', null: false },
      student_id: { type: 'id', null: false },
      status: { type: 'string', size: 20, default: 'present' }, // present|absent|late|excused
      note: { type: 'string', size: 255 },
      recorded_by: { type: 'id' },
      recorded_at: { type: 'datetime' },
    },
    indexes: [{ columns: ['session_id', 'student_id'], unique: true }, { columns: ['student_id'] }],
    foreignKeys: [
      { column: 'session_id', ref: 'class_sessions(id)', onDelete: 'CASCADE' },
      { column: 'student_id', ref: 'users(id)', onDelete: 'CASCADE' },
    ],
  },

  enrollments: {
    columns: {
      id: { type: 'pk' },
      class_id: { type: 'id', null: false },
      student_id: { type: 'id' }, // پس از تایید به دانش‌آموز لینک می‌شود
      full_name: { type: 'string', size: 191, null: false },
      phone: { type: 'string', size: 20, null: false },
      national_code: { type: 'string', size: 20 },
      email: { type: 'string', size: 150 },
      gender: { type: 'string', size: 10 },
      education: { type: 'string', size: 120 },
      message: { type: 'text' },
      status: { type: 'string', size: 20, default: 'pending' }, // pending|approved|rejected
      source: { type: 'string', size: 20, default: 'web' }, // web|admin
      review_note: { type: 'string', size: 255 },
      reviewed_by: { type: 'id' },
      reviewed_at: { type: 'datetime' },
      created_at: { type: 'datetime' },
    },
    indexes: [{ columns: ['class_id'] }, { columns: ['status'] }, { columns: ['phone'] }],
    foreignKeys: [
      { column: 'class_id', ref: 'classes(id)', onDelete: 'CASCADE' },
      { column: 'student_id', ref: 'users(id)', onDelete: 'SET NULL' },
    ],
  },

  installment_plans: {
    columns: {
      id: { type: 'pk' },
      student_id: { type: 'id', null: false },
      class_id: { type: 'id' },
      title: { type: 'string', size: 191 },
      total_amount: { type: 'decimal', null: false, default: 0 },
      installments_count: { type: 'int', default: 1 },
      start_due_date: { type: 'date' },
      status: { type: 'string', size: 20, default: 'active' }, // active|completed|cancelled
      created_by: { type: 'id' },
      created_at: { type: 'datetime' },
    },
    indexes: [{ columns: ['student_id'] }, { columns: ['class_id'] }],
    foreignKeys: [
      { column: 'student_id', ref: 'users(id)', onDelete: 'CASCADE' },
      { column: 'class_id', ref: 'classes(id)', onDelete: 'SET NULL' },
    ],
  },

  installments: {
    columns: {
      id: { type: 'pk' },
      plan_id: { type: 'id', null: false },
      installment_no: { type: 'int', null: false },
      amount: { type: 'decimal', null: false, default: 0 },
      due_date: { type: 'date' },
      status: { type: 'string', size: 20, default: 'unpaid' }, // unpaid|paid|overdue
      paid_at: { type: 'datetime' },
      payment_id: { type: 'id' },
      notes: { type: 'string', size: 255 },
    },
    indexes: [{ columns: ['plan_id'] }, { columns: ['status', 'due_date'] }],
    foreignKeys: [{ column: 'plan_id', ref: 'installment_plans(id)', onDelete: 'CASCADE' }],
  },

  payments: {
    columns: {
      id: { type: 'pk' },
      student_id: { type: 'id' },
      class_id: { type: 'id' },
      plan_id: { type: 'id' },
      installment_id: { type: 'id' },
      amount: { type: 'decimal', null: false, default: 0 },
      method: { type: 'string', size: 20, default: 'cash' }, // cash|card_to_card|online|other
      status: { type: 'string', size: 20, default: 'paid' }, // pending|paid|rejected
      receipt_file: { type: 'string', size: 191 },
      tracking_code: { type: 'string', size: 100 },
      bank_name: { type: 'string', size: 100 },
      card_number: { type: 'string', size: 30 },
      paid_at: { type: 'datetime' },
      description: { type: 'text' },
      verified_by: { type: 'id' },
      verified_at: { type: 'datetime' },
      created_by: { type: 'id' },
      created_at: { type: 'datetime' },
    },
    indexes: [{ columns: ['student_id'] }, { columns: ['class_id'] }, { columns: ['status'] }],
    foreignKeys: [
      { column: 'student_id', ref: 'users(id)', onDelete: 'SET NULL' },
      { column: 'class_id', ref: 'classes(id)', onDelete: 'SET NULL' },
    ],
  },

  certificates: {
    columns: {
      id: { type: 'pk' },
      serial: { type: 'string', size: 60, null: false },
      student_id: { type: 'id', null: false },
      class_id: { type: 'id', null: false },
      title: { type: 'string', size: 191 },
      description: { type: 'text' },
      final_score: { type: 'decimal' },
      grade_label: { type: 'string', size: 60 },
      issue_date: { type: 'date' },
      status: { type: 'string', size: 20, default: 'issued' }, // issued|revoked
      issued_by: { type: 'id' },
      created_at: { type: 'datetime' },
    },
    indexes: [{ columns: ['serial'], unique: true }, { columns: ['student_id'] }, { columns: ['class_id'] }],
    foreignKeys: [
      { column: 'student_id', ref: 'users(id)', onDelete: 'CASCADE' },
      { column: 'class_id', ref: 'classes(id)', onDelete: 'CASCADE' },
    ],
  },

  sms_patterns: {
    columns: {
      id: { type: 'pk' },
      event_code: { type: 'string', size: 60, null: false },
      title: { type: 'string', size: 150, null: false },
      description: { type: 'text' },
      is_enabled: { type: 'bool', default: true },
      ippanel_pattern_code: { type: 'string', size: 100 },
      ippanel_params_map: { type: 'text' }, // JSON: { "کلید پترن": "کلید متغیر سیستم" }
      sample_vars: { type: 'text' }, // JSON نمونه برای پیش‌نمایش
      updated_at: { type: 'datetime' },
    },
    indexes: [{ columns: ['event_code'], unique: true }],
  },

  sms_logs: {
    columns: {
      id: { type: 'pk' },
      event_code: { type: 'string', size: 60 },
      pattern_code: { type: 'string', size: 100 },
      recipient: { type: 'string', size: 20, null: false },
      variables: { type: 'text' },
      message_preview: { type: 'text' },
      status: { type: 'string', size: 20, default: 'sent' }, // sent|failed|skipped
      provider_response: { type: 'text' },
      sent_by: { type: 'id' },
      created_at: { type: 'datetime' },
    },
    indexes: [{ columns: ['created_at'] }, { columns: ['event_code'] }, { columns: ['status'] }],
  },

  audit_logs: {
    columns: {
      id: { type: 'pk' },
      user_id: { type: 'id' },
      action: { type: 'string', size: 80, null: false },
      entity_type: { type: 'string', size: 80 },
      entity_id: { type: 'string', size: 40 },
      details: { type: 'text' },
      ip: { type: 'string', size: 60 },
      user_agent: { type: 'string', size: 255 },
      created_at: { type: 'datetime' },
    },
    indexes: [{ columns: ['created_at'] }, { columns: ['user_id'] }, { columns: ['action'] }],
  },
};

module.exports = schema;
