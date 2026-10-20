import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "@tarragon/shared";

/**
 * S47a: water, sleep, mood and the inhaler log are behind the platform module `extended_observations` (born off, INV-14). The database refuses the
 * rows while it is off; this reads the same switch so the web and the API say so plainly instead of surfacing a database error.
 * Fail closed: an unreadable switch is an OFF switch.
 */
export const EXTENDED_OBSERVATIONS_MODULE = "extended_observations";

export async function readExtendedObservationsEnabled(supabase: SupabaseClient<Database>): Promise<boolean> {
  try {
    const { data, error } = await supabase.from("platform_modules").select("is_enabled").eq("key", EXTENDED_OBSERVATIONS_MODULE).maybeSingle();
    if (error || !data) return false;
    return data.is_enabled === true;
  } catch {
    return false;
  }
}

export const LIFESTYLE_VITAL_TYPES = ["water_ml", "sleep_hours", "mood"] as const;
export type LifestyleVitalType = (typeof LIFESTYLE_VITAL_TYPES)[number];

export function isLifestyleVitalType(value: unknown): value is LifestyleVitalType {
  return typeof value === "string" && (LIFESTYLE_VITAL_TYPES as readonly string[]).includes(value);
}

export const NOT_SWITCHED_ON_MESSAGE = "This log is not switched on yet. Your care team will tell you when it is ready.";

export interface LifestyleReading {
  vital_type: LifestyleVitalType;
  water_ml?: number;
  sleep_hours?: number;
  mood?: number;
  note?: string;
}

/**
 * The vitals_readings insert row for a water, sleep or mood log: the one number goes in value_numeric (the S05 design), the unit is set by the
 * database. Pure, so the web action and the mobile route build the same row.
 */
export function lifestyleRow(
  reading: LifestyleReading,
  ctx: { patientId: string; organisationId: string; takenAt?: string; clientReadingId?: string | null; clientRecordedAt?: string | null }
): TablesInsert<"vitals_readings"> {
  const value = reading[reading.vital_type];
  if (typeof value !== "number") throw new Error(`lifestyleRow: no ${reading.vital_type} number`);
  return {
    patient_id: ctx.patientId,
    organisation_id: ctx.organisationId,
    source: "manual",
    vital_type: reading.vital_type,
    value_numeric: value,
    note: reading.note ?? null,
    taken_at: ctx.takenAt ?? new Date().toISOString(),
    ...(ctx.clientRecordedAt !== undefined ? { client_recorded_at: ctx.clientRecordedAt } : {}),
    ...(ctx.clientReadingId !== undefined ? { client_reading_id: ctx.clientReadingId } : {}),
  };
}
