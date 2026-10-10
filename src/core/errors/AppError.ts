/** خطای اپلیکیشن — با کد وضعیت HTTP و پیام فارسی کاربرپسند. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, message: string, code = 'APP_ERROR', details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(400, message, 'BAD_REQUEST', details);
  }

  static unauthorized(message = 'ابتدا وارد شوید.'): AppError {
    return new AppError(401, message, 'UNAUTHORIZED');
  }

  static forbidden(message = 'دسترسی به این منبع ندارید.'): AppError {
    return new AppError(403, message, 'FORBIDDEN');
  }

  static notFound(message = 'مورد یافت نشد.'): AppError {
    return new AppError(404, message, 'NOT_FOUND');
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError(409, message, 'CONFLICT', details);
  }

  static tooManyRequests(message = 'تعداد درخواست‌ها زیاد است. کمی بعد تلاش کنید.'): AppError {
    return new AppError(429, message, 'TOO_MANY_REQUESTS');
  }

  static internal(message = 'خطای داخلی سرور.'): AppError {
    return new AppError(500, message, 'INTERNAL');
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
