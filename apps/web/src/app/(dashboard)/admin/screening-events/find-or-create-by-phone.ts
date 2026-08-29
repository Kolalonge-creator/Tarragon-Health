import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Finds an existing profile by phone, or provisions a new patient one —
 * shared by screening-event organiser setup and on-site participant
 * registration. Phone is the identity (CLAUDE.md §4.2: "phone number is the
 * identity... there is no password"), so a real adult here gets a real,
 * phone-OTP-loginable account, unlike add-child-actions.ts's synthetic-email
 * child dependents (a child cannot hold an account; a screening-event
 * participant or organiser can and should, so they can later see their own
 * results/report).
 */
export async function findOrCreateProfileByPhone(args: {
  phone: string;
  fullName: string;
  organisationId: string;
}): Promise<{ id: string } | { error: string }> {
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("phone", args.phone)
    .maybeSingle();
  if (existing) return { id: existing.id };

  const svc = createServiceRoleClient();
  const { data, error } = await svc.auth.admin.createUser({
    phone: args.phone,
    phone_confirm: true,
    app_metadata: { role: "patient", organisation_id: args.organisationId },
    user_metadata: { full_name: args.fullName },
  });
  if (error || !data.user) {
    return { error: error?.message ?? "Could not create a record for this phone number" };
  }
  return { id: data.user.id };
}
