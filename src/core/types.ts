export type RoleName = 
  | 'super_admin'
  | 'executive_manager'
  | 'education_manager'
  | 'registrar'
  | 'finance_staff'
  | 'attendance_officer'
  | 'teacher'
  | 'student'
  | string;

export interface SystemSettingsTable {
  key: string;
  value_json: string;
  category: string;
  is_secret: number; // 0 or 1
  updated_at: string;
}

export interface RolesTable {
  id?: number;
  name: string;
  title_fa: string;
  is_system: number; // 0 or 1
  permissions_json: string;
  created_at: string;
  updated_at: string;
}

export interface UsersTable {
  id?: number;
  full_name: string;
  mobile: string;
  email: string | null;
  password_hash: string;
  role_id: number;
  status: 'active' | 'inactive' | 'suspended';
  avatar_path: string | null;
  must_change_password: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface SessionsTable {
  id: string;
  user_id: number;
  ip_address: string;
  user_agent: string;
  expires_at: string;
  created_at: string;
}

export interface AuditLogsTable {
  id?: number;
  user_id: number | null;
  action: string;
  entity_type: string;
  entity_id: string;
  old_values_json: string | null;
  new_values_json: string | null;
  ip_address: string;
  created_at: string;
}

export interface TeachersTable {
  id?: number;
  user_id: number;
  internal_code: string;
  specialties: string | null;
  bio: string | null;
  contract_status: 'active' | 'on_leave' | 'terminated';
  contract_start_date: string | null;
  management_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudentsTable {
  id?: number;
  user_id: number;
  student_code: string;
  national_id: string | null;
  emergency_contact: string | null;
  parent_name: string | null;
  parent_phone: string | null;
  address: string | null;
  internal_notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CoursesTable {
  id?: number;
  title: string;
  code: string;
  category: string;
  level: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ClassesTable {
  id?: number;
  course_id: number;
  title: string;
  code: string;
  capacity: number;
  tuition_fee: number | string; // BIGINT
  start_date: string;
  end_date: string;
  schedule_days: string;
  start_time: string;
  end_time: string;
  location: string;
  status: 'draft' | 'open_for_prereg' | 'enrolling' | 'capacity_full' | 'in_progress' | 'completed' | 'cancelled';
  poster_path: string | null;
  prereg_enabled: number;
  prereg_fields_json: string | null;
  min_attendance_percent: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ClassTeachersTable {
  id?: number;
  class_id: number;
  teacher_id: number;
  role_in_class: string;
  created_at: string;
}

export interface ClassSessionsTable {
  id?: number;
  class_id: number;
  session_number: number;
  session_date: string;
  start_time: string;
  end_time: string;
  topic: string | null;
  teacher_id: number | null;
  status: 'scheduled' | 'held' | 'cancelled' | 'rescheduled';
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PreregistrationsTable {
  id?: number;
  class_id: number;
  tracking_code: string;
  full_name: string;
  mobile: string;
  email: string | null;
  extra_data_json: string | null;
  attachment_path: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'needs_correction';
  reject_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnrollmentsTable {
  id?: number;
  student_id: number;
  class_id: number;
  preregistration_id: number | null;
  status: 'active' | 'completed' | 'cancelled' | 'dropped';
  tuition_agreed: number | string; // BIGINT
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceRecordsTable {
  id?: number;
  session_id: number;
  student_id: number;
  status: 'present' | 'absent' | 'late' | 'excused' | 'unrecorded';
  note: string | null;
  recorded_by_user_id: number;
  created_at: string;
  updated_at: string;
}

export interface InstallmentsTable {
  id?: number;
  enrollment_id: number;
  installment_number: number;
  amount: number | string;
  due_date: string;
  status: 'pending' | 'paid' | 'overdue' | 'partially_paid';
  paid_amount: number | string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentsTable {
  id?: number;
  enrollment_id: number;
  installment_id: number | null;
  amount: number | string;
  payment_method: 'cash' | 'card_to_card' | 'lump_sum' | 'manual' | 'online_gateway';
  status: 'pending' | 'approved' | 'rejected';
  receipt_number: string | null;
  receipt_file_path: string | null;
  reject_reason: string | null;
  paid_at: string;
  verified_by_user_id: number | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface CertificateTemplatesTable {
  id?: number;
  title: string;
  template_html: string;
  background_path: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface CertificatesTable {
  id?: number;
  enrollment_id: number;
  certificate_code: string;
  template_id: number;
  title: string;
  recipient_name: string;
  course_title: string;
  issue_date: string;
  file_path: string | null;
  qr_code_path: string | null;
  status: 'active' | 'revoked';
  revoke_reason: string | null;
  revoked_at: string | null;
  revoked_by_user_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface SmsTemplatesTable {
  id?: number;
  event_key: string;
  title: string;
  is_active: number;
  ippanel_pattern_code: string;
  variable_mappings_json: string;
  default_values_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface SmsLogsTable {
  id?: number;
  event_key: string;
  recipient_mobile: string;
  pattern_code: string;
  payload_json: string;
  status: 'queued' | 'sent' | 'delivered' | 'failed';
  provider_message_id: string | null;
  error_message: string | null;
  idempotency_key: string;
  attempts: number;
  scheduled_at: string;
  sent_at: string | null;
  created_at: string;
}

export interface FilesTable {
  id?: number;
  original_name: string;
  stored_name: string;
  file_path: string;
  mime_type: string;
  size_bytes: number;
  entity_type: string;
  entity_id: string;
  uploaded_by_user_id: number;
  created_at: string;
}

export interface DatabaseSchema {
  system_settings: SystemSettingsTable;
  roles: RolesTable;
  users: UsersTable;
  sessions: SessionsTable;
  audit_logs: AuditLogsTable;
  teachers: TeachersTable;
  students: StudentsTable;
  courses: CoursesTable;
  classes: ClassesTable;
  class_teachers: ClassTeachersTable;
  class_sessions: ClassSessionsTable;
  preregistrations: PreregistrationsTable;
  enrollments: EnrollmentsTable;
  attendance_records: AttendanceRecordsTable;
  installments: InstallmentsTable;
  payments: PaymentsTable;
  certificate_templates: CertificateTemplatesTable;
  certificates: CertificatesTable;
  sms_templates: SmsTemplatesTable;
  sms_logs: SmsLogsTable;
  files: FilesTable;
}

export interface AuthUser {
  id: number;
  full_name: string;
  mobile: string;
  email: string | null;
  role_id: number;
  role_name: string;
  role_title_fa: string;
  permissions: string[];
  status: 'active' | 'inactive' | 'suspended';
  avatar_path: string | null;
  teacher_id?: number;
  student_id?: number;
}
