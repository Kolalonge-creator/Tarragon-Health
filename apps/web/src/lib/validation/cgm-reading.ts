import { z } from "zod";
import { GLUCOSE_RANGE, GLUCOSE_UNITS } from "./vitals";

/**
 * A batch of CGM readings posted by a partner integration for one connection.
 * CGM streams many readings, so ingestion is a batch — each is deduped
 * independently on (cgm_connection_id, external_reading_id).
 */
export const cgmReadingSchema = z.object({
  external_reading_id: z.string().trim().min(1).max(200),
  glucose_value: z.number(),
  glucose_unit: z.enum(GLUCOSE_UNITS),
  taken_at: z.string().datetime(),
});

export const cgmReadingBatchSchema = z
  .object({
    cgm_connection_id: z.string().uuid(),
    readings: z.array(cgmReadingSchema).min(1).max(500),
  })
  .superRefine((data, ctx) => {
    data.readings.forEach((reading, i) => {
      const range = GLUCOSE_RANGE[reading.glucose_unit];
      if (reading.glucose_value < range.min || reading.glucose_value > range.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `glucose_value out of range for ${reading.glucose_unit}`,
          path: ["readings", i, "glucose_value"],
        });
      }
    });
  });

export type CgmReadingBatchInput = z.infer<typeof cgmReadingBatchSchema>;
