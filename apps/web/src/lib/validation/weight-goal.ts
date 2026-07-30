import { z } from "zod";

/** Setting/editing a weight goal. kg throughout, matching every other weight
 * value in the app (vitals_readings.weight_kg, BLE scale ingestion). */
export const weightGoalSchema = z.object({
  starting_weight_kg: z.coerce.number().positive().max(400),
  goal_weight_kg: z.coerce.number().positive().max(400),
});
export type WeightGoalInput = z.infer<typeof weightGoalSchema>;
