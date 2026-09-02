import { cache } from "react";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getActingFor as getActingForUncached } from "@/lib/acting/acting-for";
import { createClient } from "@/lib/supabase/server";

// getCurrentProfile/getCurrentUser are already React cache()-wrapped
// (lib/supabase/server.ts); getActingFor is not, and both the shared layout
// and every section route below call this same helper once each per
// request, so it gets the same treatment here — otherwise "whose dashboard
// is this" would be resolved twice per page load instead of once.
const getActingFor = cache(getActingForUncached);

/**
 * Shared gate + identity resolution for every /patient/* route. Each section
 * (page.tsx, vitals/page.tsx, medications/page.tsx, ...) calls this
 * independently rather than receiving it as a prop from patient/layout.tsx —
 * Next.js server components don't thread computed values from a layout down
 * to its page, and re-deriving three cheap, cache()-backed values per route
 * is the established pattern here (see analytics/finance's own
 * layout-does-the-gate, page-does-its-own-fetch split). By the time a page
 * actually runs, the layout's own call to this function has already redirected
 * away anything ineligible, so the checks below are re-confirmations, not new
 * gates.
 */
export async function getPatientDashboardContext() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }

  // Somebody with a 'manage' grant can open the account of the person they
  // support and run it from here. The grant is re-checked on every request, so
  // this ends the moment it is revoked.
  const acting = await getActingFor();

  if (!acting && !profile.onboarding_completed_at) {
    redirect("/onboarding");
  }
  // Somebody here only to fund a parent's care has no vitals, no screenings and
  // no plan of their own, so this dashboard would be a page of empty prompts
  // about a body we are not looking after. Their home is the people they
  // support — unless they have opened somebody's account, which is the whole
  // point of being here.
  if (!acting && profile.receives_care === false) {
    redirect("/patient/supporting");
  }

  // From here on, "whose dashboard is this" is the subject, not the caller.
  // auth.uid() is still the supporter throughout: only the patient_id changes,
  // and anything written is stamped with the supporter's own name by
  // private.stamp_acting_supporter.
  const subjectId = acting?.profileId ?? profile.id;

  // The emergency safety net must show the SUBJECT's state, date of birth
  // (for age-band-aware framing — spec §49.3), and emergency contact, not the
  // caller's — a supporter in Lagos acting for a parent in Kano needs Kano's
  // (or the national default's) emergency number, and "alert my emergency
  // contact" must alert the SUBJECT's contact, not the caller's own. ActingFor
  // only carries id/name, so fetch these separately in the rare acting case;
  // when not acting, the caller's own already-loaded profile fields are
  // correct.
  let subjectState = profile.state ?? null;
  let subjectDateOfBirth = profile.date_of_birth ?? null;
  let subjectHasEmergencyContact = !!profile.emergency_contact_phone;
  if (acting) {
    const supabase = await createClient();
    const { data: subjectProfile } = await supabase
      .from("profiles")
      .select("state, date_of_birth, emergency_contact_phone")
      .eq("id", subjectId)
      .maybeSingle();
    subjectState = subjectProfile?.state ?? null;
    subjectDateOfBirth = subjectProfile?.date_of_birth ?? null;
    subjectHasEmergencyContact = !!subjectProfile?.emergency_contact_phone;
  }

  return {
    profile,
    acting,
    subjectId,
    subjectState,
    subjectDateOfBirth,
    subjectHasEmergencyContact,
  };
}
