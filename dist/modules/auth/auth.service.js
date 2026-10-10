"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = exports.MAX_PASSWORD_LENGTH = void 0;
const errors_1 = require("../../lib/errors");
const crypto_1 = require("../../lib/crypto");
const persian_1 = require("../../lib/persian");
/** Longest accepted password. Longer input is rejected rather than truncated. */
exports.MAX_PASSWORD_LENGTH = 256;
const GENERIC_LOGIN_ERROR = 'نام کاربری یا رمز عبور نادرست است.';
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;
/**
 * Authentication: password login, opaque random session tokens (only SHA-256 hashes are stored),
 * idle/absolute expiry, DB-backed brute-force protection, forced password change.
 */
class AuthService {
    db;
    audit;
    options;
    constructor(db, audit, options) {
        this.db = db;
        this.audit = audit;
        this.options = options;
    }
    get windowMinutes() {
        return this.options.lockWindowMinutes ?? 15;
    }
    get idleMinutes() {
        return this.options.sessionIdleMinutes ?? 120;
    }
    async countFailures(column, hash) {
        const since = new Date(Date.now() - this.windowMinutes * 60 * 1000);
        const rows = await this.db.query(`SELECT COUNT(*) AS n FROM login_attempts
        WHERE ${column} = ? AND success = 0 AND attempted_at >= ?`, [hash, since]);
        return Number(rows[0]?.n ?? 0);
    }
    async login(input) {
        if (input.password.length > exports.MAX_PASSWORD_LENGTH) {
            throw new errors_1.AppError(401, 'INVALID_CREDENTIALS', GENERIC_LOGIN_ERROR);
        }
        const username = (0, persian_1.normalizeUsername)(input.username);
        const identifierHash = (0, crypto_1.sha256Hex)(`id:${username}`);
        const ipHash = (0, crypto_1.sha256Hex)(`ip:${input.ip ?? 'unknown'}`);
        const [identFail, ipFail] = await Promise.all([
            this.countFailures('identifier_hash', identifierHash),
            this.countFailures('ip_hash', ipHash),
        ]);
        if (identFail >= this.options.maxFailures || ipFail >= this.options.maxFailures * 4) {
            throw errors_1.errors.tooMany();
        }
        const rows = await this.db.query(`SELECT u.id, u.username, u.full_name, u.role_id, r.slug AS role_slug, u.status,
              u.must_change_password, u.password_hash
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.username = ? LIMIT 1`, [username]);
        const user = rows[0];
        // Always run a hash verification so response timing does not reveal whether a username exists.
        let passwordOk = false;
        if (user) {
            passwordOk = await (0, crypto_1.verifyPassword)(input.password, user.password_hash);
        }
        else {
            await (0, crypto_1.verifyPassword)(input.password, DUMMY_HASH);
        }
        const allowed = Boolean(user && passwordOk && user.status === 'active');
        await this.db.execute('INSERT INTO login_attempts (identifier_hash, ip_hash, success) VALUES (?, ?, ?)', [identifierHash, ipHash, allowed ? 1 : 0]);
        if (!allowed || !user) {
            await this.audit.record({
                action: 'auth.login_failed',
                actorUserId: user?.id ?? null,
                entityType: 'user',
                entityId: user?.id ?? null,
                ip: input.ip,
                details: { username, reason: !user ? 'unknown_user' : passwordOk ? 'account_disabled' : 'bad_password' },
            });
            throw new errors_1.AppError(401, 'INVALID_CREDENTIALS', GENERIC_LOGIN_ERROR);
        }
        await this.db.execute('UPDATE users SET failed_login_count = 0, last_login_at = ? WHERE id = ?', [new Date(), user.id]);
        const token = await this.createSession(user.id, input.ip, input.userAgent);
        await this.audit.record({ action: 'auth.login_success', actorUserId: user.id, entityType: 'user', entityId: user.id, ip: input.ip });
        return token;
    }
    async createSession(userId, ip, userAgent) {
        const token = (0, crypto_1.randomToken)(32);
        // Expiry and all timestamps are computed in JS as UTC instants: the same code runs on MySQL and SQLite.
        const expiresAt = new Date(Date.now() + this.options.sessionTtlHours * 3600 * 1000);
        await this.db.execute(`INSERT INTO sessions (user_id, token_hash, ip_address, user_agent, expires_at)
       VALUES (?, ?, ?, ?, ?)`, [userId, (0, crypto_1.sha256Hex)(token), ip ? ip.slice(0, 45) : null, userAgent ? userAgent.slice(0, 255) : null, expiresAt]);
        return token;
    }
    /** Resolves a session token to an active user, or null. Touches last_seen_at at most every 5 minutes. */
    async authenticate(token) {
        if (!token || token.length > 128)
            return null;
        const rows = await this.db.query(`SELECT s.id AS session_id, s.last_seen_at, s.expires_at, s.revoked_at,
              u.id, u.username, u.full_name, u.role_id, r.slug AS role_slug, u.status,
              u.must_change_password, u.password_hash
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         JOIN roles r ON r.id = u.role_id
        WHERE s.token_hash = ? LIMIT 1`, [(0, crypto_1.sha256Hex)(token)]);
        const row = rows[0];
        if (!row || row.revoked_at || row.status !== 'active')
            return null;
        if (new Date(row.expires_at).getTime() <= Date.now())
            return null;
        if (Date.now() - new Date(row.last_seen_at).getTime() > this.idleMinutes * 60 * 1000)
            return null;
        if (Date.now() - new Date(row.last_seen_at).getTime() > LAST_SEEN_THROTTLE_MS) {
            await this.db.execute('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [new Date(), row.session_id]);
        }
        const user = {
            id: row.id,
            username: row.username,
            full_name: row.full_name,
            role_id: row.role_id,
            role_slug: row.role_slug,
            status: row.status,
            must_change_password: row.must_change_password,
            password_hash: row.password_hash,
        };
        return { sessionId: row.session_id, user };
    }
    async logout(token, actorUserId) {
        await this.db.execute('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL', [new Date(), (0, crypto_1.sha256Hex)(token)]);
        await this.audit.record({ action: 'auth.logout', actorUserId, entityType: 'user', entityId: actorUserId });
    }
    /** Revokes every active session of a user (optionally keeping one, e.g. the current session). */
    async revokeUserSessions(userId, keepSessionId = null) {
        const res = await this.db.execute(`UPDATE sessions SET revoked_at = ?
        WHERE user_id = ? AND revoked_at IS NULL AND (? IS NULL OR id <> ?)`, [new Date(), userId, keepSessionId, keepSessionId]);
        return res.affectedRows;
    }
    async changeOwnPassword(input) {
        const [user] = await this.db.query('SELECT password_hash FROM users WHERE id = ?', [input.userId]);
        if (!user || !(await (0, crypto_1.verifyPassword)(input.currentPassword, user.password_hash))) {
            throw new errors_1.AppError(400, 'WRONG_PASSWORD', 'رمز عبور فعلی نادرست است.', { currentPassword: 'رمز عبور فعلی نادرست است.' });
        }
        await this.setPassword(input.userId, input.newPassword, input.minLength, false);
        await this.revokeUserSessions(input.userId, input.currentSessionId);
        await this.audit.record({ action: 'auth.password_changed', actorUserId: input.userId, entityType: 'user', entityId: input.userId, ip: input.ip });
    }
    async setPassword(userId, password, minLength, mustChange) {
        if (password.length < minLength) {
            throw errors_1.errors.badRequest(`رمز عبور باید حداقل ${minLength} نویسه باشد.`, { password: `حداقل ${minLength} نویسه لازم است.` });
        }
        if (password.length > exports.MAX_PASSWORD_LENGTH)
            throw errors_1.errors.badRequest('رمز عبور بیش از حد طولانی است.', { password: 'رمز عبور بیش از حد طولانی است.' });
        const hash = await (0, crypto_1.hashPassword)(password);
        await this.db.execute('UPDATE users SET password_hash = ?, must_change_password = ?, password_changed_at = ? WHERE id = ?', [hash, mustChange ? 1 : 0, new Date(), userId]);
    }
}
exports.AuthService = AuthService;
/** Precomputed hash used to equalise timing for unknown usernames. Generated once at module load. */
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');
