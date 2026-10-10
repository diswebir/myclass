import { z } from 'zod';

export const preregFormFieldSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(191),
  type: z.enum(['text', 'phone', 'email', 'number', 'date', 'select']),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
});

export const preregFormSchema = z.object({
  fields: z.array(preregFormFieldSchema).min(1),
});

export const preregSubmitSchema = z.object({
  applicantName: z.string().min(1).max(191),
  phone: z.string().min(1).max(32),
  email: z.string().email().max(191).optional().or(z.literal('')),
  fieldValues: z.record(z.string()).default({}),
  // honeypot — field مخفی؛ ربات‌ها پرش می‌کنند
  website: z.string().max(0).optional().or(z.literal('')),
});

export const preregReviewSchema = z.object({
  status: z.enum(['approved', 'rejected', 'needs_fix']),
  reviewNote: z.string().max(2000).optional().or(z.literal('')),
});

export type PreregSubmitInput = z.infer<typeof preregSubmitSchema>;
