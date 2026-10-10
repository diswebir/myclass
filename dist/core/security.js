"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
exports.normalizeDigits = normalizeDigits;
exports.normalizeMobile = normalizeMobile;
exports.isValidIranianMobile = isValidIranianMobile;
exports.sanitizeForCsv = sanitizeForCsv;
exports.generateCsrfToken = generateCsrfToken;
exports.csrfMiddleware = csrfMiddleware;
const crypto_1 = __importDefault(require("crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
// 1. Password Hashing (Pure JavaScript bcryptjs)
async function hashPassword(plainText) {
    const salt = await bcryptjs_1.default.genSalt(10);
    return bcryptjs_1.default.hash(plainText, salt);
}
async function verifyPassword(plainText, hash) {
    return bcryptjs_1.default.compare(plainText, hash);
}
// 2. Normalization: Persian/Arabic digits to English digits
function normalizeDigits(input) {
    if (input === null || input === undefined)
        return '';
    const str = String(input);
    const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    return str.split('').map(char => {
        const pIndex = persianDigits.indexOf(char);
        if (pIndex !== -1)
            return String(pIndex);
        const aIndex = arabicDigits.indexOf(char);
        if (aIndex !== -1)
            return String(aIndex);
        return char;
    }).join('');
}
// 3. Iranian Mobile Number Normalizer (Standardized to 09XXXXXXXXX)
function normalizeMobile(mobile) {
    if (!mobile)
        return '';
    let cleaned = normalizeDigits(mobile).trim().replace(/[\s\-\(\)]/g, '');
    if (cleaned.startsWith('+98')) {
        cleaned = '0' + cleaned.substring(3);
    }
    else if (cleaned.startsWith('0098')) {
        cleaned = '0' + cleaned.substring(4);
    }
    else if (cleaned.startsWith('98') && cleaned.length === 12) {
        cleaned = '0' + cleaned.substring(2);
    }
    else if (!cleaned.startsWith('0') && cleaned.length === 10) {
        cleaned = '0' + cleaned;
    }
    return cleaned;
}
function isValidIranianMobile(mobile) {
    const normalized = normalizeMobile(mobile);
    return /^09[0-9]{9}$/.test(normalized);
}
// 4. Formula Injection Prevention for CSV
function sanitizeForCsv(value) {
    if (value === null || value === undefined)
        return '';
    let str = String(value).trim();
    // If the cell begins with =, +, -, @, \t, \r, prepend a single quote so spreadsheet engines do not execute it
    if (/^[=+\-@\t\r]/.test(str)) {
        str = `'${str}`;
    }
    // Escape double quotes
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        str = `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}
// 5. CSRF Synchronizer Token
function generateCsrfToken() {
    return crypto_1.default.randomBytes(24).toString('hex');
}
function csrfMiddleware(req, res, next) {
    // Ensure session has a CSRF secret/token
    let csrfToken = req.cookies?.myclass_csrf;
    if (!csrfToken) {
        csrfToken = generateCsrfToken();
        res.cookie('myclass_csrf', csrfToken, {
            httpOnly: false, // Accessible by frontend JS for AJAX headers if needed
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/'
        });
    }
    res.locals.csrfToken = csrfToken;
    // Safe HTTP methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }
    // Exempt specific endpoints (like webhooks or pure API with token header if designed)
    if (req.path.startsWith('/api/cron/')) {
        return next();
    }
    const incomingToken = req.body?._csrf || req.headers['x-csrf-token'];
    if (!incomingToken || incomingToken !== csrfToken) {
        if (req.headers.accept?.includes('application/json')) {
            return res.status(403).json({ error: 'توکن امنیتی CSRF نامعتبر است یا ارسال نشده است.' });
        }
        return res.status(403).render('public/error', {
            title: 'خطای امنیت توکن (CSRF)',
            message: 'درخواست شما به دلیل نامعتبر بودن یا منقضی شدن توکن امنیتی تایید نشد. لطفاً صفحه را رفرش کرده و مجدداً تلاش کنید.'
        });
    }
    next();
}
