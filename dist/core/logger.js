"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
function sanitize(obj) {
    if (!obj || typeof obj !== 'object')
        return obj;
    if (Array.isArray(obj))
        return obj.map(sanitize);
    const sensitiveKeys = ['password', 'password_hash', 'api_key', 'apiKey', 'token', 'secret', 'cookie', 'csrf'];
    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
        if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
            cleaned[key] = '[REDACTED]';
        }
        else if (typeof value === 'object' && value !== null) {
            cleaned[key] = sanitize(value);
        }
        else {
            cleaned[key] = value;
        }
    }
    return cleaned;
}
exports.logger = {
    info(message, meta) {
        console.log(`[INFO] ${new Date().toISOString()} - ${message}`, meta ? JSON.stringify(sanitize(meta)) : '');
    },
    warn(message, meta) {
        console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, meta ? JSON.stringify(sanitize(meta)) : '');
    },
    error(message, error) {
        const errorMeta = error instanceof Error
            ? { message: error.message, stack: error.stack }
            : sanitize(error);
        console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, errorMeta ? JSON.stringify(errorMeta) : '');
    },
    debug(message, meta) {
        if (process.env.NODE_ENV !== 'production') {
            console.debug(`[DEBUG] ${new Date().toISOString()} - ${message}`, meta ? JSON.stringify(sanitize(meta)) : '');
        }
    }
};
