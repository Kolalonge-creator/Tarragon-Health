"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { addElderProxyDependentSchema } from "@/lib/validation/elder-proxy-dependent";
import { ageFromDateOfBirth } from "@tarragon/shared";

/**
 * Provisions a login-less profile for a consenting adult who cannot
 * self-onboard — "my father does not use smartphones"
 * (docs/FAMILY_CARE_CIRCLE_SPEC.md §3.2). Same provisioning shape as
 * addChildDependentAction (a password-less, non-deliverable synthetic auth
 * user, since profiles.id is a hard FK to auth.users), but for an adult:
 * dependent_kind = 'elder_proxy' rather than 'minor_child', so
 * private.sweep_dependent_majority_review never touches this record — an
 * adult proxy arrangement has no birthday after which it should lapse the
 * way a child's does (see 20260829082711).
 *
 * Two safety differences from the child path, both because nobody here can
 * ask the elder directly the way a two-sided care_access_requests accept
 * would:
 *
 *   1. The phone number is checked against find_profile_by_phone first. A
 *      match means this person already has a Tarragon account and can
 *      accept their own eldercare request — refusing here routes them to
 *      that flow instead of letting a proxy silently take over an identity
 *      that already exists.
 *   2. confirmed_consent is a required, explicit attestation (validated at
 *      the schema level, not just implied by filling in a form), logged to
 *      audit_log so there is a record of who attested and when.
 *
 * What this does NOT solve: if the arrangement needs to be corrected or
 * revoked and the elder genuinely cannot use any digital channel, that is
 * necessarily an offline/support process — the same real-world limit any
 * proxy relationship has, not something a self-service UI can fully close.
 */
export async function addElderProxyDependentAction(
  input: unknown
): Promise<{ message: string; profileId: string } | { error: string }> {
  const parsed = addElderProxyDependentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }
  const { full_name, phone, relationship, date_of_birth, sex } = parsed.data;

  const proxy = await getCurrentProfile();
  if (!proxy) return { error: "Not signed in" };
  if (!proxy.organisation_id) return { error: "This account has no organisation on file" };

  const supabase = await createClient();
  const { data: found } = await supabase
    .rpc("find_profile_by_phone", { lookup_phone: phone })
    .maybeSingle();
  if (found) {
    return {
      error:
        found.id === proxy.id
          ? "That's your own number."
          : `${found.full_name ?? "Someone"} already has a Tarragon account on that number. Ask them to accept an eldercare request from Your people instead. They keep control of their own record that way.`,
    };
  }

  const svc = createServiceRoleClient();

  const syntheticEmail = `dependent+${randomUUID()}@dependents.tarragonhealth.internal`;
  const { data: created, error: createError } = await svc.auth.admin.createUser({
    email: syntheticEmail,
    email_confirm: true,
    app_metadata: { role: "patient", organisation_id: proxy.organisation_id },
    user_metadata: { full_name },
  });
  if (createError || !created.user) {
    return { error: createError?.message ?? "Could not create their record" };
  }
  const elderId = created.user.id;

  const { error: updateError } = await svc.rpc("provision_dependent_profile_basics", {
    p_child_id: elderId,
    p_date_of_birth: date_of_birth,
    p_sex: (sex ?? null) as unknown as "male" | "female",
    p_actor_id: proxy.id,
    p_dependent_kind: "elder_proxy",
  });
  if (updateError) {
    return { error: updateError.message };
  }

  // OQ-47 (S04b-1): the person added here has not agreed to anything yet, so the grant carries payments only. It cannot
  // carry a clinical permission until they verify their own number (private.guard_elder_proxy_grant refuses it), and the
  // blanket dependant read no longer applies to an adult (private.can_read_clinical). What the proxy may see is
  // whatever the person chooses once they sign in: that is the "Set up for my parent" flow.
  const { error: accessError } = await svc.from("profile_access").insert({
    profile_id: elderId,
    grantee_user_id: proxy.id,
    permission_level: "manage",
    granted_by: proxy.id,
    permissions: ["manage_payments"],
  });
  if (accessError) {
    return { error: accessError.message };
  }

  const { data: proxyContact } = await svc
    .from("profiles")
    .select("phone")
    .eq("id", proxy.id)
    .single();

  const { error: contactError } = await svc
    .from("profiles")
    .update({
      emergency_contact_name: proxy.full_name,
      emergency_contact_phone: proxyContact?.phone ?? null,
      emergency_contact_relationship: relationship,
      emergency_contact_consent: true,
      emergency_contact_consent_at: new Date().toISOString(),
    })
    .eq("id", elderId);
  if (contactError) {
    return { error: contactError.message };
  }

  await svc.from("audit_log").insert({
    organisation_id: proxy.organisation_id,
    actor_id: proxy.id,
    action: "profile.elder_proxy_consent_attested",
    entity_type: "profiles",
    entity_id: elderId,
    event: { relationship, confirmed_consent: true },
  });

  const age = ageFromDateOfBirth(date_of_birth);
  revalidatePath("/patient/family");
  revalidatePath("/patient");
  revalidatePath("/patient/supporting");
  return {
    message: `Added ${full_name} (${age}) to your family. You can pay for their care from here. To see or manage their health information they need to say yes on their own phone first: use "Set up for my parent" so they choose what you can see.`,
    // Additive: the sponsor purchase flow (/patient/supporting/new) needs the
    // newly created profile's id immediately, to chain straight into product
    // selection without a refetch-and-match-by-name round trip. Existing
    // callers (AddElderProxyForm) only read `message`, so this is safe.
    profileId: elderId,
  };
}
