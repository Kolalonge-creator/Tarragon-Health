import {
  EMERGENCY_CARD_FIELDS_COLUMNS,
  emergencyChoicesFromRow,
  emergencyRowFromChoices,
  type EmergencyCardChoices,
  type EmergencyCardFieldsRow,
} from "@tarragon/shared";
import { supabase } from "./supabase";
import { isOffline } from "./passport-cache";

/**
 * What the person puts on their emergency card (S43 spec 2.7, S47) from the phone: the same table and the same ten choices as the web page
 * (apps/web/src/lib/emergency/actions.ts), through @tarragon/shared so the defaults cannot drift.
 *
 * Changing the choice needs a connection and says so. The card itself keeps working offline from its saved copy (lib/emergency.ts); after a
 * save the screen reloads the facts so that copy is rewritten with the new choices, and a detail the person hid is not left on the phone.
 */
export type ChoicesResult = { ok: true; choices: EmergencyCardChoices } | { ok: false; reason: "offline" | "failed" };

export async function loadCardChoices(patientId: string): Promise<ChoicesResult> {
  const { data, error } = await supabase.from("emergency_card_fields").select(EMERGENCY_CARD_FIELDS_COLUMNS).eq("patient_id", patientId).maybeSingle();
  if (error) return { ok: false, reason: isOffline(error) ? "offline" : "failed" };
  // No row is a real answer: nothing was chosen yet, so the defaults apply.
  return { ok: true, choices: emergencyChoicesFromRow((data as EmergencyCardFieldsRow | null) ?? null) };
}

export async function saveCardChoices(patientId: string, organisationId: string, choices: EmergencyCardChoices): Promise<{ ok: true } | { ok: false; reason: "offline" | "failed" }> {
  const { error } = await supabase
    .from("emergency_card_fields")
    .upsert({ patient_id: patientId, organisation_id: organisationId, ...emergencyRowFromChoices(choices) }, { onConflict: "patient_id" });
  if (error) return { ok: false, reason: isOffline(error) ? "offline" : "failed" };
  return { ok: true };
}
