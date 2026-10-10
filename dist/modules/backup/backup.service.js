"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BackupService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const config_1 = require("../../core/config");
const logger_1 = require("../../core/logger");
class BackupService {
    db;
    policyService;
    auditService;
    constructor(db, policyService, auditService) {
        this.db = db;
        this.policyService = policyService;
        this.auditService = auditService;
    }
    // Pure JavaScript SQL Database Backup (No system mysqldump required!)
    async generateDatabaseBackup(user) {
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
        const backupDir = path_1.default.join(config_1.config.STORAGE_DIR, 'backups');
        fs_1.default.mkdirSync(backupDir, { recursive: true });
        const filePath = path_1.default.join(backupDir, filename);
        let sqlOutput = `-- ==========================================================\n`;
        sqlOutput += `-- MyClass Academy Platform Pure Node.js Database Dump\n`;
        sqlOutput += `-- Generated at: ${new Date().toISOString()}\n`;
        sqlOutput += `-- User: ${user.mobile} (${user.full_name})\n`;
        sqlOutput += `-- ==========================================================\n\n`;
        sqlOutput += `SET FOREIGN_KEY_CHECKS = 0;\n\n`;
        for (const tableName of tables) {
            try {
                const rows = await this.db.selectFrom(tableName).selectAll().execute();
                if (rows.length === 0)
                    continue;
                sqlOutput += `-- Table data: ${tableName} (${rows.length} rows)\n`;
                for (const row of rows) {
                    const keys = Object.keys(row);
                    const values = keys.map(k => {
                        const val = row[k];
                        if (val === null || val === undefined)
                            return 'NULL';
                        if (typeof val === 'number' || typeof val === 'bigint')
                            return String(val);
                        if (typeof val === 'boolean')
                            return val ? '1' : '0';
                        // Escape string
                        const strVal = String(val).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r');
                        return `'${strVal}'`;
                    });
                    sqlOutput += `INSERT INTO \`${tableName}\` (\`${keys.join('`, `')}\`) VALUES (${values.join(', ')});\n`;
                }
                sqlOutput += `\n`;
            }
            catch (err) {
                logger_1.logger.warn(`Could not export table ${tableName}`, err);
            }
        }
        sqlOutput += `SET FOREIGN_KEY_CHECKS = 1;\n-- End of backup dump\n`;
        fs_1.default.writeFileSync(filePath, sqlOutput, 'utf8');
        const stats = fs_1.default.statSync(filePath);
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
    async listBackups(user) {
        this.policyService.assertPermission(user, 'backup.manage');
        const backupDir = path_1.default.join(config_1.config.STORAGE_DIR, 'backups');
        if (!fs_1.default.existsSync(backupDir))
            return [];
        const files = fs_1.default.readdirSync(backupDir).filter(f => f.endsWith('.sql'));
        return files.map(file => {
            const p = path_1.default.join(backupDir, file);
            const stat = fs_1.default.statSync(p);
            return {
                filename: file,
                sizeBytes: stat.size,
                createdAt: stat.birthtime.toISOString()
            };
        }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
}
exports.BackupService = BackupService;
