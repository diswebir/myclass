/** Zod schemas — ماژول certificates (REQ-P5-01..04). */
import { z } from 'zod';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const templateDesignSchema = z
  .object({
    title: z.string().min(1).max(191).optional(),
    subtitle: z.string().min(1).max(191).optional(),
    primaryColor: hexColor.optional(),
    showQr: z.boolean().optional(),
    fontScale: z.number().min(0.8).max(1.5).optional(),
  })
  .strict();

export const templateConditionsSchema = z
  .object({
    min_attendance_percent: z.number().int().min(0).max(100).optional(),
    require_payment_cleared: z.boolean().optional(),
  })
  .strict();

export const createTemplateSchema = z.object({
  name: z.string().min(1).max(191),
  design: templateDesignSchema.optional(),
  conditions: templateConditionsSchema.optional(),
  isActive: z.boolean().optional(),
});

export const updateTemplateSchema = z.object({
  name: z.string().min(1).max(191).optional(),
  design: templateDesignSchema.optional(),
  conditions: templateConditionsSchema.optional(),
  isActive: z.boolean().optional(),
});

export const issueSchema = z.object({
  studentId: z.number().int().positive(),
  classId: z.number().int().positive(),
  templateId: z.number().int().positive().optional(),
});

export const issueBatchSchema = z.object({
  classId: z.number().int().positive(),
  templateId: z.number().int().positive().optional(),
  dryRun: z.boolean().optional(),
});

export const revokeSchema = z.object({
  reason: z.string().min(3).max(500),
});
