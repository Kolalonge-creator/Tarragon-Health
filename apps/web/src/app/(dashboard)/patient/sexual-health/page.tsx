import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SexualHealthHub } from "./sexual-health-hub";
import { SexualHealthPrivacyGate } from "./sexual-health-privacy-gate";

/**
 * Sexual & Reproductive Health hub (spec §47): STI risk-check + testing,
 * case follow-up, contraception (emergency contraception surfaced above the
 * routine method list — see EmergencyContraceptionCard's own "clear
 * prioritisation" reasoning), fertility, sexual wellness, and a filtered
 * slice of the Learn library — composing the module's already-built panels
 * rather than duplicating any of them.
 *
 * Plain auth/profile fetch, mirroring patient/lifestyle/page.tsx, not
 * getPatientDashboardContext's "acting for" resolution: every table this
 * module reads is patient-self-or-org-staff only by construction, with no
 * profile_access/supporter path at all (see migration 20260902211500's
 * header) — a supporter "acting for" someone else could never see this
 * data anyway, and every server action already built for this module writes
 * under auth.uid() directly, never a subject id. This page matches that.
 *
 * organisation_id is fetched here only to confirm the account is fully
 * onboarded (redirect otherwise) — it isn't threaded down as a prop because
 * every child component (already built) derives it itself from its own
 * session/profile fetch.
 */
export default async function SexualHealthPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) redirect("/onboarding");

  return (
    <SexualHealthPrivacyGate>
      <SexualHealthHub patientId={user.id} />
    </SexualHealthPrivacyGate>
  );
}
