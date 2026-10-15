import { z } from "zod";

/**
 * A reading the person photographed from a device screen and then checked digit by digit on their own phone (S70a, 18.3).
 *
 * Only numbers cross the network, never the photo: the text recognition ran on the phone and the picture stays there. The server cannot see
 * that every digit was checked, so the phone must say so (`confirmed: true`) and the route refuses anything else. The bounds are only a
 * sanity check: the database decides what is impossible (held for the person to check) and what is extreme but possible (saved and
 * triaged exactly like a typed reading).
 */
const sane = (max: number) => z.number().finite().positive().max(max);
const glucoseContext = z.enum(["fasting", "random", "post_meal"]);

export const photoReadingBody = z.discriminatedUnion("vital_type", [
  z.object({
    vital_type: z.literal("blood_pressure"),
    systolic: sane(2000),
    diastolic: sane(2000),
    pulse_bpm: sane(2000).optional(),
    cuff_type: z.enum(["upper_arm", "wrist", "not_sure"]).optional(),
  }),
  z.object({ vital_type: z.literal("glucose"), glucose_mmol_l: sane(100000), glucose_context: glucoseContext }),
  z.object({ vital_type: z.literal("weight"), weight_kg: sane(2000) }),
  z.object({ vital_type: z.literal("temperature"), temperature_c: sane(200) }),
  z.object({ vital_type: z.literal("spo2"), spo2_pct: z.number().finite().int().min(0).max(1000), pulse_bpm: sane(2000).optional() }),
]);

export const photoReadingSchema = z.object({
  /** Idempotency key made on the phone, so a retry from the offline queue never saves the reading twice. */
  client_reading_id: z.string().uuid(),
  /** When the photo was taken. The server clamps it: never in the future, never more than 7 days old. */
  taken_at: z.string().datetime(),
  /** The person says they checked every number. Anything else is refused. */
  confirmed: z.literal(true, { message: "Every number must be checked before a photo reading is saved" }),
  /** Whose reading this is, when it is not the signed-in person's own (a supporter on a shared phone). */
  patient_id: z.string().uuid().optional(),
  reading: photoReadingBody,
});

export type PhotoReadingInput = z.infer<typeof photoReadingSchema>;
