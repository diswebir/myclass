/** Zod schemas — ماژول sms (REQ-P6-03). */
import { z } from 'zod';

const variableDef = z.object({
  name: z.string().min(1).max(64),
  required: z.boolean().optional(),
  default: z.string().max(191).nullable().optional(),
});

export const patternSchema = z.object({
  name: z.string().min(1).max(191),
  patternCode: z.string().min(1).max(64),
  provider: z.string().min(1).max(64).optional(),
  variables: z.array(variableDef).optional(),
  isActive: z.boolean().optional(),
});

export const eventSchema = z.object({
  eventKey: z.string().min(1).max(64),
  name: z.string().min(1).max(191),
  patternId: z.number().int().positive().nullable().optional(),
  enabled: z.boolean().optional(),
  delayMinutes: z.number().int().min(0).max(10080).optional(),
  /** internal variable name -> pattern variable name */
  mapping: z.record(z.string().min(1).max(64)).optional(),
  /** recipient source: student | teacher | class_students | custom */
  recipient: z.enum(['student', 'teacher', 'class_students', 'custom']).optional(),
  retryMax: z.number().int().min(0).max(10).optional(),
});

export const testSendSchema = z.object({
  patternId: z.number().int().positive().optional(),
  eventKey: z.string().min(1).max(64).optional(),
  recipient: z.string().min(5).max(32),
  variables: z.record(z.string().max(500)).optional(),
});
