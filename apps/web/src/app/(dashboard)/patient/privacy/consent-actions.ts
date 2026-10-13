"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Constants } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";

export type WithdrawConsentState = { success?: boolean; error?: string } | undefined;

const consentTypeSchema = z.object({ consentType: z.enum(Constants.public.Enums.consent_type) });

/** PostgREST error for a check_violation raised by the consent trigger (for example a required consent while the account is active). */
const CHECK_VIOLATION = "23514";

async function recordOptionalConsent(consentType: string, action: "accepted" | "withdrawn", shownVersionId?: string): Promise<WithdrawConsentState> {
  const parsed = consentTypeSchema.safeParse({ consentType });
  if (!parsed.success) return { error: "That consent does not exist." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };

  const [{ data: profile }, { data: version }] = await Promise.all([
    supabase.from("profiles").select("organisation_id").eq("id", user.id).single(),
    // Accepting records the exact version the person was shown (the database refuses it if it has since been replaced). Withdrawing
    // needs no version: the database ends whichever acceptance is in force.
    action === "accepted" && shownVersionId
      ? supabase.from("consent_versions").select("id, version, is_optional").eq("id", shownVersionId).eq("consent_type", parsed.data.consentType).maybeSingle()
      : supabase.from("consent_versions").select("id, version, is_optional").eq("consent_type", parsed.data.consentType).eq("is_current", true).maybeSingle(),
  ]);
  if (!profile?.organisation_id || !version) return { error: "We could not find that consent." };
  if (!version.is_optional) {
    return {
      error:
        action === "withdrawn"
          ? "This one is needed to use your account. To stop it, close your account using the data rights options on this page."
          : "This one is given when you set up your account, not here.",
    };
  }

  // The database derives who made the choice and the exact-text hash; the channel is the only receipt field the app supplies.
  const { error } = await supabase.from("patient_consents").insert({
    organisation_id: profile.organisation_id,
    patient_id: user.id,
    consent_type: parsed.data.consentType,
    consent_version_id: version.id,
    version: version.version,
    action,
    channel: "web",
  });
  if (error) {
    // The database refuses a required consent while the account is active. Say so rather than "try again".
    if (error.code === CHECK_VIOLATION && action === "withdrawn") {
      return { error: "This one is needed to use your account. To stop it, close your account using the data rights options on this page." };
    }
    if (error.code === CHECK_VIOLATION && action === "accepted") {
      return { error: "The wording changed while you were reading. Please reload the page and read the new version." };
    }
    return { error: "We could not record that just then. Please try again." };
  }

  revalidatePath("/patient/privacy");
  return { success: true };
}

/**
 * Two-tap withdrawal of an OPTIONAL consent (v5 function 1.15). The history stays: a withdrawal is one more
 * append-only patient_consents row (the database derives which acceptance it ends), never an edit or a delete.
 *
 * A REQUIRED purpose is refused here and, since S04b-2 (OQ-53), by the database too: withdrawing it means closing the
 * account, which is a decision about the account (the data rights options), not a toggle on a list.
 */
export async function withdrawConsentAction(consentType: string): Promise<WithdrawConsentState> {
  return recordOptionalConsent(consentType, "withdrawn");
}

/**
 * Giving an OPTIONAL consent. One explicit choice per purpose after the person has read the text; nothing is ticked for
 * them and nothing is bundled (one row per purpose). Required purposes are given when the account is set up, not here.
 * Wording still pending approval (is_draft) is invisible to patients, so there is nothing to give until it is published.
 */
export async function grantConsentAction(consentType: string, shownVersionId: string): Promise<WithdrawConsentState> {
  return recordOptionalConsent(consentType, "accepted", shownVersionId);
}
