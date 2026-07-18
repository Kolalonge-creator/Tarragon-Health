import { z } from "zod";

export const planDailyLimitSchema = z.coerce
  .number()
  .int()
  .min(1, "Must be at least 1 message")
  .max(500, "Must be at most 500 messages");
