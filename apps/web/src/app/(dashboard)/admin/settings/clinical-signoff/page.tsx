import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { LoadFailure } from "@/components/ui/load-failure";
import { readClinicalSignoffChecklist } from "@/lib/clinical/read-clinical-signoff-checklist";
import { SignoffChecklist } from "./signoff-checklist";

export const metadata = { title: "Clinical sign-off" };

/**
 * The "what still needs my signature, and what do I press" page.
 *
 * The sign-off queue on /admin/settings/clinical-protocols already reported
 * WHAT was outstanding, correctly. What it could not do was tell you what to
 * DO about it: for a clinical rule it said "needs an owner and a linked
 * signed protocol assigned (via a new draft version)", which is accurate and
 * almost unusable — the reader has to know that a shadow rule's governance
 * fields are immutable, that the fix is to duplicate it into a fresh draft,
 * and that the draft is the thing you sign. Seven rules sat unsigned from
 * 2026-08-29 to 2026-09-16 behind that sentence.
 *
 * This page is the same information with the next action attached to it, and
 * it deliberately renders ONLY what is actionable plus a short list of what
 * is already done, so "am I finished?" is answerable at a glance.
 *
 * Data-fetch/row-shaping logic lives in
 * lib/clinical/read-clinical-signoff-checklist.ts (extracted 2026-09-22) so
 * the CMO's own reachable mirror at /clinician/clinical-signoff renders the
 * exact same checklist, never a second copy that can drift.
 */
export default async function ClinicalSignoffPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/admin");

  const supabase = await createClient();
  const data = await readClinicalSignoffChecklist(supabase, "/admin/settings");

  if (data.loadFailed) {
    return <LoadFailure>The sign-off checklist could not be loaded.</LoadFailure>;
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-charcoal-ink">Clinical sign-off</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">
          Everything on the platform that needs a Clinical Director&apos;s signature before it may act
          on a patient, and the one action that signs it. You are signing that the rule matches a
          protocol you stand behind — not writing the rule, which is already fixed and cannot be
          edited here.
        </p>
      </div>

      <SignoffChecklist
        unsignedRules={data.unsignedRules}
        signedRules={data.signedRules}
        unsignedConfigs={data.unsignedConfigs}
        settled={data.settled}
        staff={data.staff}
        protocols={data.protocols}
        totalConfigCount={data.totalConfigCount}
      />
    </div>
  );
}
