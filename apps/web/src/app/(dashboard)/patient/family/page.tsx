import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { AddChildForm } from "./add-child-form";
import { NextOfKinForm, type NextOfKinState } from "./next-of-kin-form";
import { DependantsList } from "./dependants-list";
import { AdultsYouManageList } from "./adults-you-manage-list";
import { CareAccessRequestsList, type CareAccessRequestRow } from "./care-access-requests-list";
import { CareVisibilityList } from "./care-visibility-list";
import { CareAccessLog, type CareAccessLogRow } from "./care-access-log";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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
 * profile_access — in its two levels, and, since 20260730025553,
 * care_access_requests as the two-sided accept that now sits in front of
 * both:
 *
 *   view    a next of kin follows the record and cannot change it
 *   manage  either a parent acting for a child who has no login of their own
 *           (unconditional — see AddChildForm), or, between two adults who
 *           each hold their own account, an eldercare grant that only exists
 *           once the other party has accepted a request (see the caregiver
 *           wizard linked below).
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

  // Every still-open proposal involving the caller, either side. RLS already
  // scopes this to rows where profile_id or counterparty_user_id = the
  // caller, so the .or() below is belt-and-braces, not the only guard.
  const { data: rawRequests } = await supabase
    .from("care_access_requests")
    .select(
      `id, profile_id, counterparty_user_id, initiated_by, permission_level, relationship, created_at,
       owner:profiles!care_access_requests_profile_id_fkey(full_name),
       counterparty:profiles!care_access_requests_counterparty_user_id_fkey(full_name)`
    )
    .or(`profile_id.eq.${profile.id},counterparty_user_id.eq.${profile.id}`)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  const requests: CareAccessRequestRow[] = (rawRequests ?? []).map((r) => ({
    id: r.id,
    profile_id: r.profile_id,
    counterparty_user_id: r.counterparty_user_id,
    initiated_by: r.initiated_by,
    permission_level: r.permission_level,
    relationship: r.relationship,
    created_at: r.created_at,
    owner_name: r.owner?.full_name ?? null,
    counterparty_name: r.counterparty?.full_name ?? null,
  }));

  // The next-of-kin card wants to know if it's already waiting on someone,
  // not just whether they've accepted — same requests already fetched above.
  const pendingNextOfKinRequest =
    requests.find(
      (r) =>
        r.profile_id === profile.id &&
        r.initiated_by === profile.id &&
        r.permission_level === "view"
    ) ?? null;

  const nextOfKin: NextOfKinState = {
    name: me?.emergency_contact_name ?? null,
    phone: me?.emergency_contact_phone ?? null,
    relationship: me?.emergency_contact_relationship ?? null,
    grantId: viewGrant?.id ?? null,
    pendingRequestId: pendingNextOfKinRequest?.id ?? null,
  };

  // Grant-lifecycle events RLS already scopes to the caller: rows about their
  // own record (patient_id) or actions they themselves took (actor_profile_id).
  const { data: rawAccessEvents } = await supabase
    .from("care_access_events")
    .select(
      `id, kind, occurred_at, patient_id, actor_profile_id,
       patient:profiles!care_access_events_patient_id_fkey(full_name),
       actor:profiles!care_access_events_actor_profile_id_fkey(full_name),
       subject:profiles!care_access_events_subject_profile_id_fkey(full_name)`
    )
    .order("occurred_at", { ascending: false })
    .limit(30);

  const accessEvents: CareAccessLogRow[] = (rawAccessEvents ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    occurredAt: row.occurred_at,
    isAboutMe: row.patient_id === profile.id,
    actorIsMe: row.actor_profile_id === profile.id,
    patientName: row.patient?.full_name ?? null,
    actorName: row.actor?.full_name ?? null,
    subjectName: row.subject?.full_name ?? null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Your people</h1>
        <p className="text-charcoal-ink/60">
          Who we contact if something urgent comes up, who can follow your care, and the children
          whose records you keep. Everyone keeps their own account and their own subscription.
        </p>
      </div>

      <CareAccessRequestsList requests={requests} currentUserId={profile.id} />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <DependantsList />
          <AddChildForm />
        </div>
        <AdultsYouManageList />
      </div>

      <NextOfKinForm current={nextOfKin} />

      <CareVisibilityList />

      <CareAccessLog events={accessEvents} />

      <Card>
        <CardHeader>
          <CardTitle>Managing care together</CardTitle>
          <CardDescription>
            For an adult who should be able to act on a record, not just follow it (bookings,
            prescriptions, vaccinations), set that up with its own step-by-step request.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/patient/family/caregiver">Set up manage access</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
