import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * S44 (spec 2.13): the on-device health-store route (Apple Health, Android Health Connect) stores nothing for a person whose
 * `wearable_device_data` consent is not in force. The operating-system permission the person gave on the phone says what the app may READ;
 * this is the platform's own consent to STORE it. The latest consent row decides (accepted and not later withdrawn; a tie counts as withdrawn),
 * and a failed check is a refusal, never a pass.
 *
 * Returns the 403 response to send, or null when the consent is in force. Granting is the consent screen's job (S42); until the approved
 * wording exists and a consent version for this type is published, nobody can grant it, so this route refuses. That is deliberate (OQ-S44-5).
 */
export async function deviceDataConsentRefusal(svc: SupabaseClient<Database>, patientId: string): Promise<NextResponse | null> {
  const { data, error } = await svc.rpc("consent_in_force", { p_patient: patientId, p_type: "wearable_device_data" });
  if (!error && data === true) return null;
  return NextResponse.json(
    {
      error: "consent_required",
      message: "Allow TarragonHealth to keep your wearable and device data in your privacy settings before syncing.",
    },
    { status: 403 }
  );
}
