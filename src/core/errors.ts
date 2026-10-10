export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: Record<string, any>;

  constructor(message: string, statusCode = 500, isOperational = true, details?: Record<string, any>) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'خطای اعتبارسنجی ورودی‌ها', details?: Record<string, any>) {
    super(message, 400, true, details);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'ابتدا وارد سامانه شوید') {
    super(message, 401, true);
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'شما دسترسی مجاز برای این عملیات را ندارید') {
    super(message, 403, true);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'مورد درخواستی یافت نشد') {
    super(message, 404, true);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'تداخل در ثبت اطلاعات؛ رکورد مورد نظر وجود دارد') {
    super(message, 409, true);
  }
}
