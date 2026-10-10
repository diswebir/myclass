/** هش رمز عبور با bcryptjs (JS خالص — per spec §۲). */
import bcrypt from 'bcryptjs';

export async function hashPassword(password: string, rounds: number): Promise<string> {
  return bcrypt.hash(password, rounds);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

export interface PasswordPolicyResult {
  ok: boolean;
  errors: string[];
}

export function validatePasswordPolicy(password: string): PasswordPolicyResult {
  const errors: string[] = [];
  if (password.length < 8) errors.push('رمز عبور باید حداقل ۸ کاراکتر باشد.');
  if (password.length > 72) errors.push('رمز عبور نباید بیشتر از ۷۲ کاراکتر باشد.');
  if (!/[a-zA-Z]/.test(password)) errors.push('رمز عبور باید شامل حرف انگلیسی باشد.');
  if (!/[0-9۰-۹]/.test(password)) errors.push('رمز عبور باید شامل عدد باشد.');
  return { ok: errors.length === 0, errors };
}
