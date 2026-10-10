"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConflictError = exports.NotFoundError = exports.AuthorizationError = exports.AuthenticationError = exports.ValidationError = exports.AppError = void 0;
class AppError extends Error {
    statusCode;
    isOperational;
    details;
    constructor(message, statusCode = 500, isOperational = true, details) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.details = details;
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.AppError = AppError;
class ValidationError extends AppError {
    constructor(message = 'خطای اعتبارسنجی ورودی‌ها', details) {
        super(message, 400, true, details);
    }
}
exports.ValidationError = ValidationError;
class AuthenticationError extends AppError {
    constructor(message = 'ابتدا وارد سامانه شوید') {
        super(message, 401, true);
    }
}
exports.AuthenticationError = AuthenticationError;
class AuthorizationError extends AppError {
    constructor(message = 'شما دسترسی مجاز برای این عملیات را ندارید') {
        super(message, 403, true);
    }
}
exports.AuthorizationError = AuthorizationError;
class NotFoundError extends AppError {
    constructor(message = 'مورد درخواستی یافت نشد') {
        super(message, 404, true);
    }
}
exports.NotFoundError = NotFoundError;
class ConflictError extends AppError {
    constructor(message = 'تداخل در ثبت اطلاعات؛ رکورد مورد نظر وجود دارد') {
        super(message, 409, true);
    }
}
exports.ConflictError = ConflictError;
