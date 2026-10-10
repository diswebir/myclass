import { z } from 'zod';

export const createUserSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_.-]+$/, 'نام کاربری فقط حروف انگلیسی، عدد، نقطه، خط تیره و زیرخط مجاز است.'),
  email: z.string().email().max(191).optional().or(z.literal('')),
  phone: z.string().max(32).optional().or(z.literal('')),
  fullName: z.string().min(1).max(191),
  password: z.string().min(8).max(72),
  roleIds: z.array(z.coerce.number().int().positive()).default([]),
  isActive: z.coerce.number().int().min(0).max(1).default(1),
});

export const updateUserSchema = z.object({
  email: z.string().email().max(191).optional().or(z.literal('')),
  phone: z.string().max(32).optional().or(z.literal('')),
  fullName: z.string().min(1).max(191),
  isActive: z.coerce.number().int().min(0).max(1).default(1),
});

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(8).max(72),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
