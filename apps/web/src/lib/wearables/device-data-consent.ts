import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * S44 (spec 2.13): the on-device health-store route (Apple Health, Android Health Connect) stores nothing for a person whose
 * `wearable_device_data` consent is not in force. The operating-system permission the person gave on the phone says what the app may READ;
 * this is the platform's own consent to STORE it. S47d: the consent matrix cell device_data x care is the ONE source of truth (the older
 * wearable_device_data consent was folded into it), the database refuses a device-sourced write without it, and a failed check is a refusal, never a pass.
 *
 * Returns the 403 response to send, or null when the consent is in force. Granting is the first-use prompt on the Devices screen or the privacy page; the wording is a placeholder pending counsel.
 */
export async function deviceDataConsentRefusal(svc: SupabaseClient<Database>, patientId: string): Promise<NextResponse | null> {
  const { data, error } = await svc.rpc("device_data_consent_in_force", { p_patient: patientId });
  if (!error && data === true) return null;
  return NextResponse.json(
    {
      error: "consent_required",
      message: "Allow TarragonHealth to keep your wearable and device data in your privacy settings before syncing.",
    },
    { status: 403 }
  );
}
