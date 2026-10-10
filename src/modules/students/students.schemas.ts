import { z } from 'zod';

export const studentSchema = z.object({
  code: z.string().min(1).max(64),
  firstName: z.string().min(1).max(191),
  lastName: z.string().min(1).max(191),
  phone: z.string().min(1).max(32),
  email: z.string().email().max(191).optional().or(z.literal('')),
  nationalId: z.string().max(32).optional().or(z.literal('')),
  guardianName: z.string().max(191).optional().or(z.literal('')),
  guardianPhone: z.string().max(32).optional().or(z.literal('')),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export type StudentInput = z.infer<typeof studentSchema>;

/** ستون‌های CSV ورود گروهی */
export const CSV_COLUMNS = [
  'code', 'firstName', 'lastName', 'phone', 'email', 'nationalId',
  'guardianName', 'guardianPhone', 'birthDate', 'notes',
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];
