import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().min(1, 'نام کاربری را وارد کنید.'),
  password: z.string().min(1, 'رمز عبور را وارد کنید.'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'رمز عبور فعلی را وارد کنید.'),
  newPassword: z.string().min(8, 'رمز عبور جدید باید حداقل ۸ کاراکتر باشد.'),
  confirmPassword: z.string().min(1, 'تکرار رمز عبور را وارد کنید.'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
