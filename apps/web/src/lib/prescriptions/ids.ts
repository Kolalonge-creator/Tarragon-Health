import { z } from "zod";

const uuid = z.string().uuid();

/** Route-parameter validation (every API route validates input with Zod). */
export function isUuid(value: string | null | undefined): value is string {
  return uuid.safeParse(value).success;
}
