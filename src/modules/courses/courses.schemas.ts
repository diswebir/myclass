import { z } from 'zod';

export const courseSchema = z.object({
  title: z.string().min(1).max(255),
  code: z.string().min(1).max(64),
  category: z.string().max(128).optional().or(z.literal('')),
  level: z.string().max(64).optional().or(z.literal('')),
  description: z.string().max(4000).optional().or(z.literal('')),
  defaultFee: z.string().regex(/^\d+$/).default('0'),
  durationHours: z.coerce.number().int().min(0).max(10000).optional(),
  isActive: z.coerce.number().int().min(0).max(1).default(1),
});

export type CourseInput = z.infer<typeof courseSchema>;
