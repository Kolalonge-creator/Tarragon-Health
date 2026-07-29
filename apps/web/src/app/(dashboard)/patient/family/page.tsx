import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { AddChildForm } from "./add-child-form";
import { NextOfKinForm, type NextOfKinState } from "./next-of-kin-form";
import { DependantsList } from "./dependants-list";

/**
 * The people around one person's care.
 *
 * Not a plan page. Until removal 4 (20260729143514) this was the Family Plan
 * dashboard, gated on has_feature_access('family_dashboard') and listing whoever
 * shared the subscriber's bill. Enrolment is individual now, so there is no
 * shared bill to list and nothing here is entitlement-gated: being able to name
 * a next of kin, and to keep a young child's vaccination card, is not something
 * a person should have to buy.
 *
 * What remains is the consent model that was always underneath it —
 * profile_access — in its two levels:
 *
 *   view    a next of kin follows the record and cannot change it
 *   manage  a parent acts for a child who has no login of their own
 */
export default async function CareCirclePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "patient") redirect("/");

  const supabase = await createClient();

  const { data: me } = await supabase
    .from("profiles")
    .select(
      "emergency_contact_name, emergency_contact_phone, emergency_contact_relationship"
    )
    .eq("id", profile.id)
    .single();

  // Grants over this caller's own record. RLS scopes profile_access SELECT to
  // rows the caller either owns or is the grantee of, so this returns exactly
  // the people who can see them.
  const { data: grants } = await supabase
    .from("profile_access")
    .select("id, permission_level, created_at")
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: true });

  const viewGrant = (grants ?? []).find((grant) => grant.permission_level === "view") ?? null;

  const nextOfKin: NextOfKinState = {
    name: me?.emergency_contact_name ?? null,
    phone: me?.emergency_contact_phone ?? null,
    relationship: me?.emergency_contact_relationship ?? null,
    grantId: viewGrant?.id ?? null,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Your people</h1>
        <p className="text-charcoal-ink/60">
          Who we contact if something urgent comes up, who can follow your care, and the children
          whose records you keep. Everyone keeps their own account and their own subscription.
        </p>
      </div>

      <NextOfKinForm current={nextOfKin} />
      <DependantsList />
      <AddChildForm />
    </div>
  );
}
