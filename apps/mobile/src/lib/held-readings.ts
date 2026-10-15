import { supabase } from "./supabase";

/**
 * Readings the database held because the number cannot be real (S70a, 18.9). They wait for the person: enter it again, or leave it out.
 * A held reading is never part of the record and never triaged; resolving one never creates a reading by itself.
 */
export interface HeldReading {
  id: string;
  vitalType: string;
  source: string;
  summary: string;
  createdAt: string;
}

export function summariseHeld(vitalType: string, payload: Record<string, unknown>): string {
  switch (vitalType) {
    case "blood_pressure":
      return `${payload.systolic ?? "?"}/${payload.diastolic ?? "?"} mmHg`;
    case "glucose":
      return `${payload.glucose_mmol_l ?? "?"} mmol/L`;
    case "weight":
      return `${payload.weight_kg ?? "?"} kg`;
    case "pulse":
      return `${payload.pulse_bpm ?? "?"} bpm`;
    case "temperature":
      return `${payload.temperature_c ?? "?"} °C`;
    case "spo2":
      return `${payload.spo2_pct ?? "?"}%`;
    default:
      return "a reading";
  }
}

export type HeldLoad = { ok: true; items: HeldReading[] } | { ok: false };

/** A failed load is `ok: false`, never an empty list: "nothing is waiting" and "we could not check" are different things. */
export async function loadHeldReadings(patientId: string): Promise<HeldLoad> {
  try {
    const { data, error } = await supabase
      .from("vitals_readings_held")
      .select("id, vital_type, source, payload, created_at")
      .eq("patient_id", patientId)
      .eq("state", "pending")
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) return { ok: false };
    return {
      ok: true,
      items: (data ?? []).map((row) => ({
        id: row.id,
        vitalType: row.vital_type,
        source: row.source,
        summary: summariseHeld(row.vital_type, (row.payload ?? {}) as Record<string, unknown>),
        createdAt: row.created_at,
      })),
    };
  } catch {
    return { ok: false };
  }
}

export async function discardHeldReading(id: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc("resolve_held_reading", { p_id: id, p_state: "discarded" });
    return !error;
  } catch {
    return false;
  }
}
