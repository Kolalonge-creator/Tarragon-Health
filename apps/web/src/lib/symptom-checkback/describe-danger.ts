import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

/**
 * S59c (OQ-S59c-05, founder decision): the person typed danger wording into the "describe it" box. The device already showed the emergency
 * guidance. This tells the care team the FACT, on the existing emergency path, and nothing else.
 *
 * What may travel: a per-session key (a random id made on the device), and a coarse code, `danger` or `self_harm`. The typed words, any matched
 * phrase and any fragment of them NEVER reach this code (the input schema is strict, so an extra field is refused, not passed on), a log line,
 * Sentry or the event row. The result says whether the fact was recorded and whether a clinician was actually paged; the screen says the care
 * team was told ONLY when `doctorAlerted` is true (a Free plan gets the guidance record and no page, and the screen must say that instead). A failure never throws and never blocks the guidance on screen (the database audits it and opens a sev3 incident as well).
 */
export const describeDangerInputSchema = z.object({ session: z.string().uuid(), category: z.enum(["danger", "self_harm"]) }).strict();

export type DescribeDangerResult = { recorded: boolean; doctorAlerted: boolean; reason?: "acting_for" };

type Rpc = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> };

export async function recordDescribeDanger(supabase: SupabaseClient, userId: string | null, input: unknown): Promise<DescribeDangerResult> {
  const parsed = describeDangerInputSchema.safeParse(input);
  if (!parsed.success || !userId) return { recorded: false, doctorAlerted: false };
  try {
    const { data, error } = await (supabase as unknown as Rpc).rpc("record_describe_danger", { p_session: parsed.data.session, p_category: parsed.data.category });
    if (error) {
      // only the database's error code is reported (no words were ever sent)
      Sentry.captureException(new Error(`describe danger could not be recorded: ${error.code ?? "unknown"}`));
      return { recorded: false, doctorAlerted: false };
    }
    const result = (typeof data === "object" && data !== null ? data : {}) as { recorded?: unknown; reason?: unknown; doctor_alerted?: unknown };
    if (result.recorded !== true && result.reason === "error") Sentry.captureException(new Error("describe danger could not be recorded: database refused"));
    const recorded = result.recorded === true;
    // a human was paged ONLY when the database says so; a plan without doctor time gets the event and the guidance record, no page
    return { recorded, doctorAlerted: recorded && result.doctor_alerted === true };
  } catch {
    Sentry.captureException(new Error("describe danger could not be recorded: call failed"));
    return { recorded: false, doctorAlerted: false };
  }
}
