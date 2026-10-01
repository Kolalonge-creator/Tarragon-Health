"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Constants } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";

export type WithdrawConsentState = { success?: boolean; error?: string } | undefined;

const withdrawSchema = z.object({ consentType: z.enum(Constants.public.Enums.consent_type) });

/**
 * Two-tap withdrawal of an OPTIONAL consent (v5 function 1.15). The history stays: a withdrawal is one more
 * append-only patient_consents row (the database derives which acceptance it ends), never an edit or a delete.
 *
 * A REQUIRED purpose is refused here on purpose. Withdrawing it would close the gate that lets this account use the
 * service, which is a decision about the account (the data rights page), not a toggle on a list.
 */
export async function withdrawConsentAction(consentType: string): Promise<WithdrawConsentState> {
  const parsed = withdrawSchema.safeParse({ consentType });
  if (!parsed.success) return { error: "That consent does not exist." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };

  const [{ data: profile }, { data: version }] = await Promise.all([
    supabase.from("profiles").select("organisation_id").eq("id", user.id).single(),
    supabase
      .from("consent_versions")
      .select("id, version, is_optional")
      .eq("consent_type", parsed.data.consentType)
      .eq("is_current", true)
      .maybeSingle(),
  ]);
  if (!profile?.organisation_id || !version) return { error: "We could not find that consent." };
  if (!version.is_optional) {
    return { error: "This one is needed to use your account. To stop it, use the data rights options on this page." };
  }

  const { error } = await supabase.from("patient_consents").insert({
    organisation_id: profile.organisation_id,
    patient_id: user.id,
    consent_type: parsed.data.consentType,
    consent_version_id: version.id,
    version: version.version,
    action: "withdrawn",
  });
  if (error) return { error: "We could not record that just then. Please try again." };

  revalidatePath("/patient/privacy");
  return { success: true };
}
