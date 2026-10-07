import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { AiGovernancePanel } from "../_signoff-panels/ai-governance-panel";

export const metadata = { title: "AI governance sign-off" };

/**
 * The Chief Medical Officer / Clinical Director's own reachable path to the
 * two pieces of AI governance work only they can close — approving an
 * `ai_system_versions` row, and recording an independent tier judgement on
 * an `ai_evaluation_cases` clinical-accuracy scenario. Mirrors
 * /clinician/clinical-signoff's pattern exactly (see that page's own
 * comment): `admin/settings/ai-governance/page.tsx` is gated on the
 * `ai_governance.manage` permission key, but proxy.ts's `/admin/*` gate
 * refuses a plain `clinician` login before that page would even load unless
 * the account holds an explicit delegated grant — so a real CMO (account
 * role always `clinician`, per CLAUDE.md's "never re-split the account
 * role" rule) had no way to even see this work existed, let alone act on
 * it, despite the admin dashboard's own welcome banner naming it "real,
 * time-sensitive work sitting on a Chief Medical Officer's desk."
 *
 * Deliberately scoped to just the two sign-off actions the admin welcome
 * banner flags — not a second copy of the full console (kill switch,
 * incident triage, prompt activation, monitoring dashboard), which stays
 * admin-only for now. `readPendingAiGovernanceSignoff` is the shared count
 * both this page and that banner read, so they can never disagree.
 */
export default async function ClinicianAiGovernancePage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) {
    redirect("/clinician");
  }

  return (
    <div className="space-y-8 p-6">
      <div>
        <h1 className="text-xl font-semibold text-charcoal-ink">AI governance sign-off</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">
          Everything the platform&apos;s AI systems owe your signature or your independent clinical
          judgement before they can be called validated. Kill-switch control, incident triage, and
          the full monitoring dashboard stay on the admin console; this page is only the two actions
          that need an active Chief Medical Officer specifically.
        </p>
      </div>

      <AiGovernancePanel />
    </div>
  );
}
