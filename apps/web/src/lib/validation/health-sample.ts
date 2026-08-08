import { z } from "zod";
import { WEARABLE_READING_TYPES } from "@/lib/wearables/normalise";

/**
 * A batch of Apple Health (HealthKit) samples uploaded by the Expo app.
 *
 * HealthKit has no cloud API — its data is device-local, so unlike every
 * other wearable provider there is no server-side OAuth redirect and no
 * webhook. The phone is the only thing that can read it, which is why this
 * arrives as an authenticated upload from the mobile app rather than as an
 * inbound provider callback.
 *
 * The reading_type vocabulary is shared with the cloud-sync path on purpose:
 * once a sample is named, it goes through exactly the same routing rule
 * (vitals-equivalent metrics to vitals_readings, everything else to
 * wearable_readings) as a Fitbit or Oura reading. One ingestion contract,
 * two ways in.
 */

export const healthSampleSchema = z
  .object({
    reading_type: z.enum(WEARABLE_READING_TYPES),
    value: z.number().finite(),
    /** Diastolic, for blood_pressure only. */
    secondary_value: z.number().finite().optional(),
    unit: z.string().trim().min(1).max(24),
    recorded_at: z.string().datetime(),
    /** HealthKit's own sample UUID, so re-running a sync is idempotent. */
    external_reading_id: z.string().trim().min(1).max(200),
  })
  .refine(
    (sample) => sample.reading_type !== "blood_pressure" || sample.secondary_value !== undefined,
    { path: ["secondary_value"], message: "blood_pressure requires a diastolic value" }
  );

export const healthSampleBatchSchema = z.object({
  // HealthKit can return a very long history on a first sync; the app pages
  // rather than posting everything at once.
  samples: z.array(healthSampleSchema).min(1).max(500),
});

export type HealthSampleInput = z.infer<typeof healthSampleSchema>;
export type HealthSampleBatchInput = z.infer<typeof healthSampleBatchSchema>;
