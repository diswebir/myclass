/**
 * تایپ‌های جداول (Kysely Database) — با migrations/ و docs/erd.md همگام.
 *قراردادها:
 * - id: BIGINT auto-increment (Generated)
 * - مبالغ: string (BIGINT — کوچک‌ترین واحد پول)
 * - تاریخ/زمان: string ('YYYY-MM-DD HH:MM:SS' UTC / 'YYYY-MM-DD')
 * - بولین‌ها: number (0/1) — قابل حمل بین MySQL و SQLite
 * - JSON: string
 */
import type { Generated } from 'kysely';

export interface Database {
  settings: SettingsTable;
  system_state: SystemStateTable;
  modules_registry: ModulesRegistryTable;
  audit_log: AuditLogTable;
  rate_limits: RateLimitsTable;
  users: UsersTable;
  roles: RolesTable;
  permissions: PermissionsTable;
  role_permissions: RolePermissionsTable;
  user_roles: UserRolesTable;
  user_sessions: UserSessionsTable;
  files: FilesTable;
  teachers: TeachersTable;
  students: StudentsTable;
  courses: CoursesTable;
  classes: ClassesTable;
  class_teachers: ClassTeachersTable;
  class_sessions: ClassSessionsTable;
  prereg_forms: PreregFormsTable;
  preregistrations: PreregistrationsTable;
  enrollments: EnrollmentsTable;
  attendance: AttendanceTable;
  payment_methods: PaymentMethodsTable;
  payments: PaymentsTable;
  installments: InstallmentsTable;
  ledger_entries: LedgerEntriesTable;
  card_receipts: CardReceiptsTable;
  certificate_templates: CertificateTemplatesTable;
  certificates: CertificatesTable;
  sms_patterns: SmsPatternsTable;
  sms_events: SmsEventsTable;
  sms_queue: SmsQueueTable;
  notifications: NotificationsTable;
}

// ---------- سیستم ----------

export interface SettingsTable {
  key: string;
  category: string;
  value: string;
  is_secret: Generated<number>;
  updated_at: Generated<string>;
  updated_by: number | null;
}

export interface SystemStateTable {
  key: string;
  value: string;
  updated_at: Generated<string>;
}

export interface ModulesRegistryTable {
  slug: string;
  name: string;
  version: string;
  status: string;
  manifest: string;
  installed_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface AuditLogTable {
  id: Generated<number>;
  actor_id: number | null;
  action: string;
  module: string;
  entity_type: string;
  entity_id: string;
  meta: Generated<string>;
  ip: string | null;
  created_at: Generated<string>;
}

export interface RateLimitsTable {
  key: string;
  window_start: string;
  count: number;
  expires_at: string;
}

// ---------- هویت ----------

export interface UsersTable {
  id: Generated<number>;
  username: string;
  email: string | null;
  phone: string | null;
  password_hash: string;
  full_name: string;
  is_active: Generated<number>;
  must_change_password: Generated<number>;
  failed_login_attempts: Generated<number>;
  locked_until: string | null;
  last_login_at: string | null;
  last_login_ip: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
  deleted_at: string | null;
}

export interface RolesTable {
  id: Generated<number>;
  name: string;
  slug: string;
  description: string | null;
  is_system: Generated<number>;
  is_active: Generated<number>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface PermissionsTable {
  id: Generated<number>;
  module: string;
  resource: string;
  action: string;
  description: string | null;
}

export interface RolePermissionsTable {
  role_id: number;
  permission_id: number;
}

export interface UserRolesTable {
  user_id: number;
  role_id: number;
}

export interface UserSessionsTable {
  token_hash: string;
  user_id: number;
  csrf_token: string;
  ip: string | null;
  user_agent: string | null;
  created_at: Generated<string>;
  expires_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

// ---------- فایل‌ها و اشخاص ----------

export interface FilesTable {
  id: Generated<number>;
  owner_type: string;
  owner_id: number;
  stored_name: string;
  original_name: string;
  mime: string;
  size: string;
  storage_path: string;
  uploaded_by: number | null;
  created_at: Generated<string>;
  deleted_at: string | null;
}

export interface TeachersTable {
  id: Generated<number>;
  user_id: number | null;
  code: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  specialties: Generated<string>;
  status: Generated<string>;
  started_at: string | null;
  photo_file_id: number | null;
  notes: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
  deleted_at: string | null;
}

export interface StudentsTable {
  id: Generated<number>;
  user_id: number | null;
  code: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  national_id: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  birth_date: string | null;
  status: Generated<string>;
  joined_at: string | null;
  notes: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
  deleted_at: string | null;
}

// ---------- آموزشی ----------

export interface CoursesTable {
  id: Generated<number>;
  title: string;
  code: string;
  category: string | null;
  level: string | null;
  description: string | null;
  default_fee: Generated<string>;
  duration_hours: number | null;
  is_active: Generated<number>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
  deleted_at: string | null;
}

export type ClassStatus =
  | 'draft'
  | 'open'
  | 'full'
  | 'running'
  | 'finished'
  | 'cancelled';

export interface ClassesTable {
  id: Generated<number>;
  course_id: number | null;
  title: string;
  code: string;
  description: string | null;
  type: string | null;
  category: string | null;
  level: string | null;
  capacity: number;
  fee: string;
  start_date: string | null;
  end_date: string | null;
  weekdays: Generated<string>;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  status: Generated<string>;
  poster_file_id: number | null;
  prereg_enabled: Generated<number>;
  prereg_deadline: string | null;
  prerequisites: string | null;
  cancellation_policy: string | null;
  created_by: number | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
  deleted_at: string | null;
}

export interface ClassTeachersTable {
  class_id: number;
  teacher_id: number;
  assigned_at: Generated<string>;
  assigned_by: number | null;
  removed_at: string | null;
}

export type SessionStatus = 'held' | 'cancelled' | 'rescheduled';

export interface ClassSessionsTable {
  id: Generated<number>;
  class_id: number;
  session_date: string;
  start_time: string | null;
  duration_minutes: number | null;
  topic: string | null;
  teacher_id: number | null;
  status: Generated<string>;
  status_note: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
  deleted_at: string | null;
}

export interface PreregFormsTable {
  id: Generated<number>;
  class_id: number;
  fields: string;
  is_active: Generated<number>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export type PreregStatus = 'pending' | 'approved' | 'rejected' | 'needs_fix';

export interface PreregistrationsTable {
  id: Generated<number>;
  class_id: number;
  form_id: number | null;
  tracking_code: string;
  applicant_name: string;
  phone: string;
  email: string | null;
  field_values: Generated<string>;
  status: Generated<string>;
  review_note: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  converted_enrollment_id: number | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export type EnrollmentStatus = 'active' | 'withdrawn' | 'completed' | 'cancelled';

export interface EnrollmentsTable {
  id: Generated<number>;
  class_id: number;
  student_id: number;
  status: Generated<string>;
  fee_amount: string;
  discount_amount: Generated<string>;
  enrolled_by: number | null;
  enrolled_at: Generated<string>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

// ---------- حضور و غیاب ----------

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused' | 'unset';

export interface AttendanceTable {
  id: Generated<number>;
  session_id: number;
  student_id: number;
  status: Generated<string>;
  note: string | null;
  marked_by: number | null;
  marked_at: Generated<string>;
  updated_by: number | null;
  updated_at: string | null;
  created_at: Generated<string>;
}

// ---------- مالی ----------

export interface PaymentMethodsTable {
  id: Generated<number>;
  name: string;
  type: string;
  is_active: Generated<number>;
  created_at: Generated<string>;
}

export type PaymentStatus = 'pending' | 'approved' | 'rejected' | 'reversed';

export interface PaymentsTable {
  id: Generated<number>;
  student_id: number;
  enrollment_id: number | null;
  method_id: number;
  amount: string;
  idempotency_key: string;
  status: Generated<string>;
  note: string | null;
  created_by: number | null;
  created_at: Generated<string>;
  approved_by: number | null;
  approved_at: string | null;
  reversed_by: number | null;
  reversed_at: string | null;
  reversal_payment_id: number | null;
}

export type InstallmentStatus = 'pending' | 'partial' | 'paid' | 'overdue';

export interface InstallmentsTable {
  id: Generated<number>;
  enrollment_id: number;
  amount: string;
  due_date: string;
  paid_amount: Generated<string>;
  status: Generated<string>;
  note: string | null;
  created_by: number | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface LedgerEntriesTable {
  id: Generated<number>;
  payment_id: number;
  student_id: number;
  entry_type: string; // debit | credit | reversal
  amount: string;
  balance_after: string | null;
  description: string | null;
  created_by: number | null;
  created_at: Generated<string>;
}

export type CardReceiptStatus = 'pending' | 'approved' | 'rejected';

export interface CardReceiptsTable {
  id: Generated<number>;
  student_id: number;
  enrollment_id: number | null;
  file_id: number;
  amount: string;
  status: Generated<string>;
  review_note: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  payment_id: number | null;
  idempotency_key: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

// ---------- مدارک ----------

export interface CertificateTemplatesTable {
  id: Generated<number>;
  name: string;
  design: Generated<string>;
  file_id: number | null;
  conditions: Generated<string>;
  is_active: Generated<number>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export type CertificateStatus = 'issued' | 'revoked';

export interface CertificatesTable {
  id: Generated<number>;
  template_id: number | null;
  student_id: number;
  class_id: number | null;
  code: string;
  status: Generated<string>;
  revoke_reason: string | null;
  issued_by: number | null;
  issued_at: Generated<string>;
  file_id: number | null;
  verification_token: string;
  revoked_by: number | null;
  revoked_at: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

// ---------- پیامک ----------

export interface SmsPatternsTable {
  id: Generated<number>;
  name: string;
  pattern_code: string;
  provider: Generated<string>;
  variables: Generated<string>;
  is_active: Generated<number>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface SmsEventsTable {
  id: Generated<number>;
  event_key: string;
  name: string;
  pattern_id: number | null;
  enabled: Generated<number>;
  delay_minutes: Generated<number>;
  mapping: Generated<string>;
  condition: Generated<string>;
  recipient: Generated<string>;
  retry_max: Generated<number>;
  retry_backoff_minutes: Generated<number>;
  is_active: Generated<number>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export type SmsQueueStatus = 'pending' | 'sending' | 'sent' | 'failed';

export interface SmsQueueTable {
  id: Generated<number>;
  event_id: number | null;
  recipient: string;
  variables: string;
  dedupe_key: string;
  status: Generated<string>;
  attempts: Generated<number>;
  next_attempt_at: string | null;
  last_error: string | null;
  sent_at: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

// ---------- اعلان‌ها ----------

export interface NotificationsTable {
  id: Generated<number>;
  user_id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: Generated<string>;
}
