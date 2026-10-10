import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { Request, Response, NextFunction } from 'express';
import { AuthenticationError, AuthorizationError } from './errors';

// 1. Password Hashing (Pure JavaScript bcryptjs)
export async function hashPassword(plainText: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plainText, salt);
}

export async function verifyPassword(plainText: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainText, hash);
}

// 2. Normalization: Persian/Arabic digits to English digits
export function normalizeDigits(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return '';
  const str = String(input);
  const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

  return str.split('').map(char => {
    const pIndex = persianDigits.indexOf(char);
    if (pIndex !== -1) return String(pIndex);
    const aIndex = arabicDigits.indexOf(char);
    if (aIndex !== -1) return String(aIndex);
    return char;
  }).join('');
}

// 3. Iranian Mobile Number Normalizer (Standardized to 09XXXXXXXXX)
export function normalizeMobile(mobile: string | null | undefined): string {
  if (!mobile) return '';
  let cleaned = normalizeDigits(mobile).trim().replace(/[\s\-\(\)]/g, '');
  if (cleaned.startsWith('+98')) {
    cleaned = '0' + cleaned.substring(3);
  } else if (cleaned.startsWith('0098')) {
    cleaned = '0' + cleaned.substring(4);
  } else if (cleaned.startsWith('98') && cleaned.length === 12) {
    cleaned = '0' + cleaned.substring(2);
  } else if (!cleaned.startsWith('0') && cleaned.length === 10) {
    cleaned = '0' + cleaned;
  }
  return cleaned;
}

export function isValidIranianMobile(mobile: string): boolean {
  const normalized = normalizeMobile(mobile);
  return /^09[0-9]{9}$/.test(normalized);
}

// 4. Formula Injection Prevention for CSV
export function sanitizeForCsv(value: any): string {
  if (value === null || value === undefined) return '';
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
export function generateCsrfToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

export function csrfMiddleware(req: Request, res: Response, next: NextFunction) {
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
