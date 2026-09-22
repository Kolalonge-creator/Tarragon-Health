import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { LoadFailure } from "@/components/ui/load-failure";
import { readClinicalSignoffChecklist } from "@/lib/clinical/read-clinical-signoff-checklist";
import { SignoffChecklist } from "@/app/(dashboard)/admin/settings/clinical-signoff/signoff-checklist";

/**
 * The Chief Medical Officer / Clinical Director's own reachable path to the
 * "what still needs my signature, and what do I press" checklist. Mirrors
 * /clinician/protocols and /clinician/triage-protocols' pattern exactly:
 * `admin/settings/clinical-signoff/page.tsx` hard-redirects anyone whose
 * `profiles.role !== "admin"`, and proxy.ts's /admin/* gate refuses a plain
 * `clinician` login before that page would even load — so a real CMO
 * (account role always `clinician`, per CLAUDE.md's "never re-split the
 * account role" rule) could not reach the single most actionable governance
 * page on the platform at all.
 *
 * Found 2026-09-22, same audit that found sign_alert_rules /
 * sign_escalation_slas / sign_mental_health_screening_cadences /
 * sign_provider_quality_policy / sign_vaccination_schedule are all already
 * Clinical-Director-only at the RPC level with no admin fallback — meaning
 * before this page (and the matching *_insert RLS fix in
 * 20260922193027_cmo_governed_config_insert_dual_gate.sql) existed, nobody
 * could complete a sign-off on 5 of the 8 GOVERNED_CONFIG_TABLES through the
 * UI at all: an admin login could open a draft but never sign it, and the
 * only account that could sign it had no RLS path to open one, and no page
 * to reach it from even if it did.
 *
 * Reuses readClinicalSignoffChecklist + SignoffChecklist as-is — same data,
 * same component, `basePath="/clinician"` so every "fix this" link in the
 * checklist points somewhere this account can actually open (see that
 * function's own comment on why the href can't stay hardcoded to
 * /admin/settings/*).
 */
export default async function ClinicianClinicalSignoffPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) {
    redirect("/clinician");
  }

  const supabase = await createClient();
  const data = await readClinicalSignoffChecklist(supabase, "/clinician");

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
