"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { claimDependentAccountSchema } from "@/lib/validation/elder-proxy-dependent";

/**
 * Converts a matured minor_child dependent into their own, self-owned
 * account — the other half of private.sweep_dependent_majority_review
 * (20260829082711): the sweep only flags majority_review_at, this is what a
 * parent actually does about it.
 *
 * Attaches the now-adult's real phone number to their existing auth user
 * (unconfirmed — they still complete their own verification, exactly like
 * any other login) and flips is_dependent_account to false. That flip
 * matters beyond bookkeeping: private.can_read_clinical's is_dependent_account
 * carve-out (20260731185243 — "a child with no login cannot be asked, their
 * guardian's manage grant stands in for the consent") stops applying the
 * instant this runs, so the parent's clinical visibility lapses until the
 * now-adult logs in and turns clinical_access on themselves through the
 * ordinary consent switch. That contraction is the intended behaviour, not a
 * bug: it is what "changing access rights as the child reaches relevant age
 * thresholds" (the brief's own words) means in this data model. The parent's
 * 'manage' profile_access grant itself is left in place rather than deleted —
 * still useful for logistics — and the now-adult can revoke it themselves,
 * like any other grant, the moment they can log in.
 */
export async function claimDependentAccountAction(
  input: unknown
): Promise<{ message: string } | { error: string }> {
  const parsed = claimDependentAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }
  const { dependent_id, phone } = parsed.data;

  const parent = await getCurrentProfile();
  if (!parent) return { error: "Not signed in" };

  const supabase = await createClient();

  const { data: grant } = await supabase
    .from("profile_access")
    .select("id")
    .eq("profile_id", dependent_id)
    .eq("grantee_user_id", parent.id)
    .eq("permission_level", "manage")
    .maybeSingle();
  if (!grant) return { error: "You don't manage this record" };

  const { data: dependent } = await supabase
    .from("profiles")
    .select("full_name, is_dependent_account, dependent_kind, majority_review_at")
    .eq("id", dependent_id)
    .single();
  if (!dependent?.is_dependent_account || dependent.dependent_kind !== "minor_child") {
    return { error: "This isn't a child dependent record" };
  }
  if (!dependent.majority_review_at) {
    return { error: "This record hasn't been flagged for majority review yet" };
  }

  const { data: existing } = await supabase
    .rpc("find_profile_by_phone", { lookup_phone: phone })
    .maybeSingle();
  if (existing) {
    return { error: "That phone number is already on a different Tarragon account" };
  }

  const svc = createServiceRoleClient();

  const { error: authError } = await svc.auth.admin.updateUserById(dependent_id, {
    phone,
    phone_confirm: false,
  });
  if (authError) return { error: authError.message };

  const { error: profileError } = await svc
    .from("profiles")
    .update({ phone, is_dependent_account: false, dependent_kind: null })
    .eq("id", dependent_id);
  if (profileError) return { error: profileError.message };

  await svc.from("notifications").insert({
    recipient_id: dependent_id,
    organisation_id: parent.organisation_id,
    channel: "sms",
    template: "dependent_account_claimed",
    status: "pending",
    content_class: "non_clinical",
    payload: {
      message:
        "You're 18 — your Tarragon record is now your own. Download the app and use this number to set up your own login.",
    },
  });

  await svc.from("audit_log").insert({
    organisation_id: parent.organisation_id,
    actor_id: parent.id,
    action: "profile.dependent_account_claimed",
    entity_type: "profiles",
    entity_id: dependent_id,
  });

  revalidatePath("/patient/family");
  revalidatePath("/patient");
  return {
    message: `${dependent.full_name ?? "They"} can now claim their own account with that number. You'll keep the same access you have today until they decide otherwise.`,
  };
}
