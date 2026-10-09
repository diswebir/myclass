"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errors = exports.AppError = void 0;
/**
 * Application error with a safe, user-facing (Persian) message.
 * Internal details must go to the server log only, never to the response.
 */
class AppError extends Error {
    status;
    code;
    fieldErrors;
    constructor(status, code, message, fieldErrors = {}) {
        super(message);
        this.name = 'AppError';
        this.status = status;
        this.code = code;
        this.fieldErrors = fieldErrors;
    }
}
exports.AppError = AppError;
exports.errors = {
    badRequest: (message, fieldErrors = {}) => new AppError(400, 'BAD_REQUEST', message, fieldErrors),
    unauthorized: () => new AppError(401, 'UNAUTHORIZED', 'لطفاً ابتدا وارد شوید.'),
    forbidden: () => new AppError(403, 'FORBIDDEN', 'شما مجوز انجام این عملیات را ندارید.'),
    notFound: (what = 'مورد') => new AppError(404, 'NOT_FOUND', `${what} یافت نشد.`),
    conflict: (message) => new AppError(409, 'CONFLICT', message),
    tooMany: (message = 'تعداد تلاش‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.') => new AppError(429, 'RATE_LIMITED', message),
    csrf: () => new AppError(403, 'CSRF', 'درخواست نامعتبر است. صفحه را تازه‌سازی کرده و دوباره تلاش کنید.'),
};
