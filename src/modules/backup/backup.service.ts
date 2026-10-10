import fs from 'fs';
import path from 'path';
import { Kysely } from 'kysely';
import { DatabaseSchema, AuthUser } from '../../core/types';
import { PolicyService } from '../../core/policy';
import { config } from '../../core/config';
import { logger } from '../../core/logger';
import { AuditService } from '../audit/audit.service';

export class BackupService {
  constructor(
    private db: Kysely<DatabaseSchema>,
    private policyService: PolicyService,
    private auditService?: AuditService
  ) {}

  // Pure JavaScript SQL Database Backup (No system mysqldump required!)
  async generateDatabaseBackup(user: AuthUser): Promise<{ filename: string; filePath: string; sizeBytes: number }> {
    this.policyService.assertPermission(user, 'backup.manage');

    const tables = [
      'system_settings',
      'roles',
      'users',
      'teachers',
      'students',
      'courses',
      'classes',
      'class_teachers',
      'class_sessions',
      'preregistrations',
      'enrollments',
      'attendance_records',
      'installments',
      'payments',
      'certificate_templates',
      'certificates',
      'sms_templates',
      'sms_logs'
    ];

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-myclass-${timestamp}.sql`;
    const backupDir = path.join(config.STORAGE_DIR, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const filePath = path.join(backupDir, filename);

    let sqlOutput = `-- ==========================================================\n`;
    sqlOutput += `-- MyClass Academy Platform Pure Node.js Database Dump\n`;
    sqlOutput += `-- Generated at: ${new Date().toISOString()}\n`;
    sqlOutput += `-- User: ${user.mobile} (${user.full_name})\n`;
    sqlOutput += `-- ==========================================================\n\n`;
    sqlOutput += `SET FOREIGN_KEY_CHECKS = 0;\n\n`;

    for (const tableName of tables) {
      try {
        const rows: any[] = await (this.db as any).selectFrom(tableName).selectAll().execute();
        if (rows.length === 0) continue;

        sqlOutput += `-- Table data: ${tableName} (${rows.length} rows)\n`;
        for (const row of rows) {
          const keys = Object.keys(row);
          const values = keys.map(k => {
            const val = row[k];
            if (val === null || val === undefined) return 'NULL';
            if (typeof val === 'number' || typeof val === 'bigint') return String(val);
            if (typeof val === 'boolean') return val ? '1' : '0';
            // Escape string
            const strVal = String(val).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r');
            return `'${strVal}'`;
          });

          sqlOutput += `INSERT INTO \`${tableName}\` (\`${keys.join('`, `')}\`) VALUES (${values.join(', ')});\n`;
        }
        sqlOutput += `\n`;
      } catch (err) {
        logger.warn(`Could not export table ${tableName}`, err);
      }
    }

    sqlOutput += `SET FOREIGN_KEY_CHECKS = 1;\n-- End of backup dump\n`;

    fs.writeFileSync(filePath, sqlOutput, 'utf8');
    const stats = fs.statSync(filePath);

    if (this.auditService) {
      await this.auditService.log({
        userId: user.id,
        action: 'CREATE_DATABASE_BACKUP',
        entityType: 'backup',
        entityId: filename,
        newValues: { sizeBytes: stats.size }
      });
    }

    return {
      filename,
      filePath,
      sizeBytes: stats.size
    };
  }

  async listBackups(user: AuthUser) {
    this.policyService.assertPermission(user, 'backup.manage');
    const backupDir = path.join(config.STORAGE_DIR, 'backups');
    if (!fs.existsSync(backupDir)) return [];

    const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.sql'));
    return files.map(file => {
      const p = path.join(backupDir, file);
      const stat = fs.statSync(p);
      return {
        filename: file,
        sizeBytes: stat.size,
        createdAt: stat.birthtime.toISOString()
      };
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
