/**
 * داده‌های اولیه (Seeds) — ماژول‌ها، دسترسی‌ها، نقش‌ها، الگوهای پیامکی و تنظیمات پیش‌فرض
 */

const MODULES = [
  { code: 'dashboard', title: 'داشبورد', icon: 'grid', sort_order: 1, is_system: true },
  { code: 'classes', title: 'کلاس‌ها', icon: 'book', sort_order: 2, is_system: true },
  { code: 'attendance', title: 'حضور و غیاب', icon: 'check-square', sort_order: 3 },
  { code: 'students', title: 'دانش‌آموزان', icon: 'users', sort_order: 4, is_system: true },
  { code: 'teachers', title: 'اساتید', icon: 'user-check', sort_order: 5 },
  { code: 'enrollments', title: 'پیش‌ثبت‌نام‌ها', icon: 'clipboard', sort_order: 6 },
  { code: 'payments', title: 'مالی و پرداخت‌ها', icon: 'wallet', sort_order: 7 },
  { code: 'certificates', title: 'مدارک', icon: 'award', sort_order: 8 },
  { code: 'sms', title: 'پنل پیامک', icon: 'message', sort_order: 9 },
  { code: 'reports', title: 'گزارش‌ها', icon: 'bar-chart', sort_order: 10 },
  { code: 'users', title: 'کاربران', icon: 'user', sort_order: 11, is_system: true },
  { code: 'roles', title: 'سطوح دسترسی', icon: 'shield', sort_order: 12 },
  { code: 'settings', title: 'تنظیمات', icon: 'settings', sort_order: 13, is_system: true },
  { code: 'audit', title: 'گزارش رویدادها', icon: 'activity', sort_order: 14 },
  { code: 'modules', title: 'ماژول‌های سیستم', icon: 'package', sort_order: 15 },
  { code: 'portal', title: 'پنل کاربری', icon: 'home', sort_order: 16, is_system: true },
];

const PERMISSIONS = [
  { code: 'dashboard.view', title: 'مشاهده داشبورد', module_code: 'dashboard', sort_order: 1 },
  { code: 'classes.view', title: 'مشاهده کلاس‌ها', module_code: 'classes', sort_order: 1 },
  { code: 'classes.manage', title: 'مدیریت کلاس‌ها', module_code: 'classes', sort_order: 2 },
  { code: 'attendance.view', title: 'مشاهده حضور و غیاب', module_code: 'attendance', sort_order: 1 },
  { code: 'attendance.manage', title: 'ثبت حضور و غیاب', module_code: 'attendance', sort_order: 2 },
  { code: 'students.view', title: 'مشاهده دانش‌آموزان', module_code: 'students', sort_order: 1 },
  { code: 'students.manage', title: 'مدیریت دانش‌آموزان', module_code: 'students', sort_order: 2 },
  { code: 'teachers.view', title: 'مشاهده اساتید', module_code: 'teachers', sort_order: 1 },
  { code: 'teachers.manage', title: 'مدیریت اساتید', module_code: 'teachers', sort_order: 2 },
  { code: 'enrollments.view', title: 'مشاهده پیش‌ثبت‌نام‌ها', module_code: 'enrollments', sort_order: 1 },
  { code: 'enrollments.manage', title: 'بررسی پیش‌ثبت‌نام‌ها', module_code: 'enrollments', sort_order: 2 },
  { code: 'payments.view', title: 'مشاهده مالی', module_code: 'payments', sort_order: 1 },
  { code: 'payments.manage', title: 'مدیریت مالی', module_code: 'payments', sort_order: 2 },
  { code: 'certificates.view', title: 'مشاهده مدارک', module_code: 'certificates', sort_order: 1 },
  { code: 'certificates.manage', title: 'صدور مدرک', module_code: 'certificates', sort_order: 2 },
  { code: 'sms.view', title: 'مشاهده پیامک‌ها', module_code: 'sms', sort_order: 1 },
  { code: 'sms.manage', title: 'مدیریت الگوها و تنظیمات پیامک', module_code: 'sms', sort_order: 2 },
  { code: 'sms.send', title: 'ارسال پیامک', module_code: 'sms', sort_order: 3 },
  { code: 'reports.view', title: 'مشاهده گزارش‌ها', module_code: 'reports', sort_order: 1 },
  { code: 'users.view', title: 'مشاهده کاربران', module_code: 'users', sort_order: 1 },
  { code: 'users.manage', title: 'مدیریت کاربران', module_code: 'users', sort_order: 2 },
  { code: 'roles.view', title: 'مشاهده سطوح دسترسی', module_code: 'roles', sort_order: 1 },
  { code: 'roles.manage', title: 'مدیریت سطوح دسترسی', module_code: 'roles', sort_order: 2 },
  { code: 'settings.view', title: 'مشاهده تنظیمات', module_code: 'settings', sort_order: 1 },
  { code: 'settings.manage', title: 'ویرایش تنظیمات', module_code: 'settings', sort_order: 2 },
  { code: 'audit.view', title: 'مشاهده گزارش رویدادها', module_code: 'audit', sort_order: 1 },
  { code: 'modules.manage', title: 'مدیریت ماژول‌ها', module_code: 'modules', sort_order: 1 },
  { code: 'portal.access', title: 'دسترسی به پنل کاربری', module_code: 'portal', sort_order: 1 },
];

/** نقش‌ها: عنوان + کدهای دسترسی */
const ROLES = [
  {
    key: 'superadmin',
    title: 'ناظر کل',
    description: 'دسترسی کامل به تمام بخش‌های سیستم',
    is_system: true,
    permissions: '*',
  },
  {
    key: 'manager',
    title: 'مدیر موسسه',
    description: 'مدیریت کامل آموزشی و مالی به جز تنظیمات سطح دسترسی',
    permissions: [
      'dashboard.view', 'classes.view', 'classes.manage',
      'attendance.view', 'attendance.manage',
      'students.view', 'students.manage',
      'teachers.view', 'teachers.manage',
      'enrollments.view', 'enrollments.manage',
      'payments.view', 'payments.manage',
      'certificates.view', 'certificates.manage',
      'sms.view', 'sms.manage', 'sms.send',
      'reports.view', 'users.view', 'users.manage',
      'roles.view', 'settings.view', 'audit.view', 'portal.access',
    ],
  },
  {
    key: 'operator',
    title: 'کارشناس آموزش',
    description: 'ثبت‌نام، کلاس‌ها، حضور و غیاب و مدارک',
    permissions: [
      'dashboard.view', 'classes.view', 'attendance.view', 'attendance.manage',
      'students.view', 'students.manage', 'enrollments.view', 'enrollments.manage',
      'certificates.view', 'certificates.manage', 'payments.view',
      'sms.view', 'sms.send', 'reports.view', 'portal.access',
    ],
  },
  {
    key: 'teacher',
    title: 'استاد',
    description: 'دسترسی به کلاس‌ها و دانش‌آموزان خود',
    permissions: [
      'dashboard.view', 'classes.view', 'attendance.view', 'attendance.manage',
      'students.view', 'certificates.view', 'portal.access',
    ],
  },
  {
    key: 'accountant',
    title: 'حسابدار',
    description: 'مدیریت مالی، اقساط و گزارش‌های مالی',
    permissions: [
      'dashboard.view', 'payments.view', 'payments.manage', 'students.view',
      'classes.view', 'reports.view', 'portal.access',
    ],
  },
  {
    key: 'student',
    title: 'دانش‌آموز',
    description: 'پنل کاربری دانش‌آموز',
    permissions: ['portal.access'],
  },
];

const SMS_PATTERNS = [
  {
    event_code: 'enrollment_received',
    title: 'دریافت پیش‌ثبت‌نام',
    description: 'هنگام ثبت فرم پیش‌ثبت‌نام در سایت برای متقاضی ارسال می‌شود',
    vars: ['full_name', 'class_name', 'institute_name'],
  },
  {
    event_code: 'enrollment_approved',
    title: 'تایید ثبت‌نام',
    description: 'هنگام تایید پیش‌ثبت‌نام و تشکیل پرونده دانش‌آموز',
    vars: ['full_name', 'class_name', 'class_date', 'class_time', 'username', 'password', 'institute_name'],
  },
  {
    event_code: 'enrollment_rejected',
    title: 'رد پیش‌ثبت‌نام',
    description: 'هنگام رد درخواست پیش‌ثبت‌نام',
    vars: ['full_name', 'class_name', 'institute_name'],
  },
  {
    event_code: 'welcome_user',
    title: 'خوش‌آمدگویی',
    description: 'هنگام ساخت حساب کاربری جدید',
    vars: ['full_name', 'username', 'institute_name'],
  },
  {
    event_code: 'payment_received',
    title: 'دریافت پرداخت',
    description: 'پس از ثبت یا تایید پرداخت',
    vars: ['full_name', 'amount', 'tracking_code', 'class_name', 'institute_name'],
  },
  {
    event_code: 'installment_due',
    title: 'یادآوری سررسید قسط',
    description: 'یادآوری پیش از سررسید قسط',
    vars: ['full_name', 'amount', 'due_date', 'class_name', 'institute_name'],
  },
  {
    event_code: 'installment_overdue',
    title: 'تاخیر در پرداخت قسط',
    description: 'پس از گذشت سررسید قسط',
    vars: ['full_name', 'amount', 'due_date', 'class_name', 'institute_name'],
  },
  {
    event_code: 'class_reminder',
    title: 'یادآوری جلسه کلاس',
    description: 'یادآوری قبل از شروع جلسه کلاس',
    vars: ['full_name', 'class_name', 'class_date', 'class_time', 'institute_name'],
  },
  {
    event_code: 'absence_notice',
    title: 'اطلاع غیبت',
    description: 'اطلاع‌رسانی غیبت دانش‌آموز در جلسه',
    vars: ['full_name', 'class_name', 'class_date', 'institute_name'],
  },
  {
    event_code: 'certificate_ready',
    title: 'آماده شدن مدرک',
    description: 'هنگام صدور مدرک پایان دوره',
    vars: ['full_name', 'class_name', 'serial', 'institute_name'],
  },
  {
    event_code: 'class_cancelled',
    title: 'لغو جلسه کلاس',
    description: 'هنگام لغو یک جلسه',
    vars: ['full_name', 'class_name', 'class_date', 'institute_name'],
  },
  {
    event_code: 'custom',
    title: 'پیامک دستی / سفارشی',
    description: 'برای ارسال‌های دستی از پنل',
    vars: ['full_name', 'message', 'institute_name'],
  },
];

const SETTINGS = [
  { key: 'institute_name', value: 'موسسه آموزشی من', group: 'institute' },
  { key: 'institute_slogan', value: 'آموزش با کیفیت، آینده‌ای روشن', group: 'institute' },
  { key: 'institute_logo', value: '', group: 'institute' },
  { key: 'institute_address', value: '', group: 'institute' },
  { key: 'institute_phone', value: '', group: 'institute' },
  { key: 'institute_email', value: '', group: 'institute' },
  { key: 'institute_website', value: '', group: 'institute' },
  { key: 'institute_description', value: '', group: 'institute' },
  { key: 'academic_year', value: '۱۴۰۴ - ۱۴۰۵', group: 'academic' },
  { key: 'academic_term', value: 'ترم اول', group: 'academic' },
  { key: 'week_start', value: '0', group: 'academic' },
  { key: 'registration_open', value: '1', group: 'academic' },
  { key: 'currency_label', value: 'تومان', group: 'payment' },
  { key: 'payment_enable_cash', value: '1', group: 'payment' },
  { key: 'payment_enable_card', value: '1', group: 'payment' },
  {
    key: 'payment_cards',
    value: JSON.stringify([{ bank: 'بانک ملت', holder: 'موسسه آموزشی من', number: '6104-3378-0000-0000' }]),
    group: 'payment',
  },
  { key: 'payment_card_receipt_required', value: '1', group: 'payment' },
  { key: 'installment_default_count', value: '3', group: 'payment' },
  { key: 'installment_interval_days', value: '30', group: 'payment' },
  { key: 'sms_enabled', value: '0', group: 'sms' },
  { key: 'sms_api_key', value: '', group: 'sms' },
  { key: 'sms_from_number', value: '+983000505', group: 'sms' },
  { key: 'sms_base_url', value: 'https://edge.ippanel.com/v1', group: 'sms' },
  { key: 'sms_send_delay_ms', value: '200', group: 'sms' },
  { key: 'cert_title', value: 'گواهی پایان دوره', group: 'certificate' },
  { key: 'cert_subtitle', value: 'این گواهی به دانش‌آموز گرامی اعطا می‌گردد', group: 'certificate' },
  { key: 'cert_footer_text', value: 'این مدرک در سامانه {institute_name} صادر شده و از طریق شماره سریال قابل استعلام است.', group: 'certificate' },
  { key: 'cert_sign1_name', value: '', group: 'certificate' },
  { key: 'cert_sign1_title', value: 'مدیر موسسه', group: 'certificate' },
  { key: 'cert_sign2_name', value: '', group: 'certificate' },
  { key: 'cert_sign2_title', value: 'مدیر آموزش', group: 'certificate' },
  { key: 'cert_show_qr', value: '1', group: 'certificate' },
  { key: 'security_password_min', value: '8', group: 'security' },
  { key: 'security_session_hours', value: '12', group: 'security' },
  { key: 'panel_title', value: 'سامانه مدیریت کلاس‌ها', group: 'general' },
  { key: 'theme_accent', value: '#4f46e5', group: 'general' },
  { key: 'sms_signature', value: '', group: 'sms' },
];

async function runSeeds(db, logger = console) {
  // ماژول‌ها
  for (const m of MODULES) {
    const exists = await db.one('SELECT id FROM system_modules WHERE code = ?', [m.code]);
    if (!exists) {
      await db.insert('system_modules', {
        code: m.code,
        title: m.title,
        icon: m.icon || '',
        description: '',
        is_enabled: 1,
        is_system: m.is_system ? 1 : 0,
        sort_order: m.sort_order,
      });
    }
  }

  // دسترسی‌ها
  for (const p of PERMISSIONS) {
    const exists = await db.one('SELECT id FROM permissions WHERE code = ?', [p.code]);
    if (!exists) {
      await db.insert('permissions', {
        code: p.code,
        title: p.title,
        module_code: p.module_code,
        sort_order: p.sort_order,
      });
    }
  }

  // نقش‌ها + دسترسی‌ها
  for (const r of ROLES) {
    let role = await db.one('SELECT id FROM roles WHERE title = ?', [r.title]);
    if (!role) {
      const roleId = await db.insert('roles', {
        title: r.title,
        description: r.description,
        is_system: r.is_system ? 1 : 0,
        is_active: 1,
        created_at: db.now(),
      });
      role = { id: roleId };
    }
    const permCodes = r.permissions === '*' ? PERMISSIONS.map((p) => p.code) : r.permissions;
    for (const code of permCodes) {
      const perm = await db.one('SELECT id FROM permissions WHERE code = ?', [code]);
      if (!perm) continue;
      const link = await db.one(
        'SELECT id FROM role_permissions WHERE role_id = ? AND permission_id = ?',
        [role.id, perm.id]
      );
      if (!link) {
        await db.insert('role_permissions', { role_id: role.id, permission_id: perm.id });
      }
    }
  }

  // الگوهای پیامکی
  for (const p of SMS_PATTERNS) {
    const exists = await db.one('SELECT id FROM sms_patterns WHERE event_code = ?', [p.event_code]);
    if (!exists) {
      const map = {};
      p.vars.forEach((v, i) => {
        map[`p${i + 1}`] = v;
      });
      await db.insert('sms_patterns', {
        event_code: p.event_code,
        title: p.title,
        description: p.description,
        is_enabled: 1,
        ippanel_pattern_code: '',
        ippanel_params_map: JSON.stringify(map),
        sample_vars: JSON.stringify(
          p.vars.reduce((acc, v) => {
            acc[v] = 'نمونه';
            return acc;
          }, {})
        ),
        updated_at: db.now(),
      });
    }
  }

  // تنظیمات
  for (const s of SETTINGS) {
    const exists = await db.one('SELECT id FROM settings WHERE setting_key = ?', [s.key]);
    if (!exists) {
      await db.insert('settings', {
        setting_key: s.key,
        setting_value: s.value,
        setting_group: s.group,
        updated_at: db.now(),
      });
    }
  }

  logger.log('[seed] core data ready');
}

module.exports = { runSeeds, MODULES, PERMISSIONS, ROLES, SMS_PATTERNS, SETTINGS };
