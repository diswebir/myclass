import { z } from 'zod';

export const paymentStatusSchema = z.enum(['pending', 'approved', 'rejected', 'reversed']);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const createPaymentSchema = z.object({
  studentId: z.coerce.number().int().positive(),
  enrollmentId: z.coerce.number().int().positive().optional().nullable(),
  methodId: z.coerce.number().int().positive(),
  amount: z.string().min(1).max(32),
  idempotencyKey: z.string().min(8).max(191),
  note: z.string().max(1000).optional().or(z.literal('')),
  status: paymentStatusSchema.optional(), // پیش‌فرض: approved (سبت دستی)
});

export const reviewReceiptSchema = z.object({
  action: z.enum(['approve', 'reject']),
  note: z.string().max(1000).optional().or(z.literal('')),
});

export const scheduleSchema = z.object({
  enrollmentId: z.coerce.number().int().positive(),
  count: z.coerce.number().int().min(1).max(36),
  firstDueDate: z.string().min(8).max(10), // YYYY-MM-DD (UTC date)
  amount: z.string().min(1).max(32).optional(), // اگر خالی → از مبلغ سبت‌نام به‌صورت مساوی
  note: z.string().max(1000).optional().or(z.literal('')),
});

export const reportQuerySchema = z.object({
  from: z.string().min(8).max(10).optional(),
  to: z.string().min(8).max(10).optional(),
  status: z.string().max(32).optional(),
});
